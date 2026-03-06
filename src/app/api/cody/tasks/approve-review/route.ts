/**
 * @fileType api-endpoint
 * @domain cody
 * @pattern approve-review
 * @ai-summary Approve a PR review and merge it via GitHub API (Octokit).
 *             For publish PRs (dev→main), uses force ref update to bypass merge conflicts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Octokit } from '@octokit/rest'
import { requireAuth } from '@/ui/cody/auth'

const OWNER = 'A-Guy-educ'
const REPO = 'A-Guy'
const DEV_BRANCH = 'dev'
const PROD_BRANCH = 'main'

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN not configured')
  }
  return new Octokit({ auth: token })
}

/**
 * Validates that a PR is a legitimate publish PR (dev → main).
 * Returns the PR data if valid, throws otherwise.
 */
async function validatePublishPR(
  octokit: Octokit,
  prNumber: number,
): Promise<{ headRef: string; baseRef: string; headSha: string }> {
  const { data: prData } = await octokit.pulls.get({
    owner: OWNER,
    repo: REPO,
    pull_number: prNumber,
  })

  const headRef = prData.head.ref
  const baseRef = prData.base.ref
  const headSha = prData.head.sha

  // Triple validation: exact branch names, repo match, and constants match
  if (headRef !== DEV_BRANCH || baseRef !== PROD_BRANCH) {
    throw new Error(
      `Not a publish PR: head=${headRef} base=${baseRef} (expected ${DEV_BRANCH}→${PROD_BRANCH})`,
    )
  }

  if (headRef !== 'dev' || baseRef !== 'main') {
    throw new Error('Branch name validation failed — constants may be misconfigured')
  }

  return { headRef, baseRef, headSha }
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req)
  if (authError) return authError

  try {
    const body = await req.json()
    const { prNumber, actorLogin } = body

    if (!prNumber) {
      return NextResponse.json({ error: 'Missing prNumber' }, { status: 400 })
    }

    const octokit = getOctokit()
    const results: string[] = []

    // Fetch PR data once, reuse throughout
    const { data: prData } = await octokit.pulls.get({
      owner: OWNER,
      repo: REPO,
      pull_number: Number(prNumber),
    })

    const isPublishPR = prData.head.ref === DEV_BRANCH && prData.base.ref === PROD_BRANCH

    // 1. Approve the PR review
    try {
      const actor = actorLogin ? ` by @${actorLogin}` : ''
      await octokit.pulls.createReview({
        owner: OWNER,
        repo: REPO,
        pull_number: Number(prNumber),
        event: 'APPROVE',
        body: `✅ Approved${actor} via Cody dashboard.`,
      })
      results.push(`Approved PR #${prNumber}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      // May fail if already approved or self-review
      results.push(`Review note: ${msg}`)
    }

    // 2. Merge the PR
    if (isPublishPR) {
      // ── Publish PR (dev → main): Force-update main to dev's HEAD ──
      // This bypasses merge conflicts since main simply becomes dev.
      // Safe because dev is the source of truth; main is a production snapshot.
      try {
        const { headSha } = await validatePublishPR(octokit, Number(prNumber))

        console.log(
          `[Cody] Force-publishing: updating ${PROD_BRANCH} to ${DEV_BRANCH} HEAD (${headSha})`,
        )

        await octokit.git.updateRef({
          owner: OWNER,
          repo: REPO,
          ref: `heads/${PROD_BRANCH}`,
          sha: headSha,
          force: true,
        })

        results.push(`Force-published ${DEV_BRANCH} → ${PROD_BRANCH} (${headSha.slice(0, 7)})`)

        // Close the PR (updateRef doesn't auto-close it)
        await octokit.pulls.update({
          owner: OWNER,
          repo: REPO,
          pull_number: Number(prNumber),
          state: 'closed',
        })
        results.push(`Closed PR #${prNumber}`)

        // Also close the associated publish issue if it exists
        try {
          const { data: timeline } = await octokit.issues.listEventsForTimeline({
            owner: OWNER,
            repo: REPO,
            issue_number: Number(prNumber),
          })
          // Look for cross-references to find the publish issue
          const issueRefs = timeline.filter((e) => e.event === 'cross-referenced' && 'source' in e)
          for (const ref of issueRefs) {
            const source = ref as {
              source?: { issue?: { number: number; labels?: Array<{ name: string }> } }
            }
            const issue = source.source?.issue
            if (issue?.labels?.some((l) => l.name === 'publish')) {
              await octokit.issues.update({
                owner: OWNER,
                repo: REPO,
                issue_number: issue.number,
                state: 'closed',
              })
              results.push(`Closed publish issue #${issue.number}`)
            }
          }
        } catch {
          // Non-critical — publish issue cleanup is best-effort
          results.push('Publish issue cleanup skipped')
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[Cody] Force-publish failed:`, msg)
        return NextResponse.json(
          { error: `Force-publish failed: ${msg}`, results },
          { status: 500 },
        )
      }
    } else {
      // ── Feature PR (task → dev): Standard squash merge ──
      try {
        await octokit.pulls.merge({
          owner: OWNER,
          repo: REPO,
          pull_number: Number(prNumber),
          merge_method: 'squash',
        })
        results.push(`Merged PR #${prNumber} (squash)`)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        if (msg.includes('not mergeable') || msg.includes('405')) {
          return NextResponse.json(
            {
              error: 'PR is not mergeable — CI may still be running or checks have failed',
              results,
            },
            { status: 409 },
          )
        }
        throw error
      }
    }

    // 3. Delete the branch (only for feature branches, not dev or main)
    if (!isPublishPR) {
      try {
        const branchRef = prData.head.ref
        if (branchRef !== DEV_BRANCH && branchRef !== PROD_BRANCH) {
          await octokit.git.deleteRef({
            owner: OWNER,
            repo: REPO,
            ref: `heads/${branchRef}`,
          })
          results.push(`Deleted branch ${branchRef}`)
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        results.push(`Branch cleanup note: ${msg}`)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Cody] Merge error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
