/**
 * @fileType api-endpoint
 * @domain cody
 * @pattern approve-gate
 * @ai-summary Approve a gate - merge PR, delete branch, close issue, remove labels via GitHub API
 */
import { NextRequest, NextResponse } from 'next/server'
import { Octokit } from '@octokit/rest'
import { requireAuth } from '@/ui/cody/auth'

const GATE_LABELS = {
  HARD_STOP: 'hard-stop',
  RISK_GATED: 'risk-gated',
} as const

const OWNER = 'A-Guy-educ'
const REPO = 'A-Guy'

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN not configured')
  }
  return new Octokit({ auth: token })
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req)
  if (authError) return authError

  try {
    const body = await req.json()
    const { issueNumber, prNumber, branchName } = body

    if (!issueNumber || !prNumber) {
      return NextResponse.json({ error: 'Missing issueNumber or prNumber' }, { status: 400 })
    }

    const octokit = getOctokit()
    const results: string[] = []

    // 1. Approve and merge the PR (squash)
    try {
      // Approve first
      await octokit.pulls.createReview({
        owner: OWNER,
        repo: REPO,
        pull_number: Number(prNumber),
        event: 'APPROVE',
        body: '✅ Gate approved via Cody dashboard.',
      })
    } catch {
      // May fail if already approved
    }

    try {
      await octokit.pulls.merge({
        owner: OWNER,
        repo: REPO,
        pull_number: Number(prNumber),
        merge_method: 'squash',
      })
      results.push(`Merged PR #${prNumber}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('not mergeable') || msg.includes('405')) {
        results.push(`PR #${prNumber} approved, merge may require CI checks to pass`)
      } else if (!msg.includes('already merged') && !msg.includes('Already up to date')) {
        console.error(`PR merge error: ${msg}`)
      }
      results.push(`PR #${prNumber} merged or already up to date`)
    }

    // 2. Delete the branch (if provided and not protected)
    if (branchName && branchName !== 'dev' && branchName !== 'main') {
      try {
        await octokit.git.deleteRef({
          owner: OWNER,
          repo: REPO,
          ref: `heads/${branchName}`,
        })
        results.push(`Deleted branch ${branchName}`)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        results.push(`Branch ${branchName} deleted or not found: ${msg}`)
      }
    }

    // 3. Close the issue
    try {
      await octokit.issues.update({
        owner: OWNER,
        repo: REPO,
        issue_number: Number(issueNumber),
        state: 'closed',
      })
      results.push(`Closed issue #${issueNumber}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push(`Issue close note: ${msg}`)
    }

    // 4. Remove gate labels
    for (const label of [GATE_LABELS.HARD_STOP, GATE_LABELS.RISK_GATED]) {
      try {
        await octokit.issues.removeLabel({
          owner: OWNER,
          repo: REPO,
          issue_number: Number(issueNumber),
          name: label,
        })
      } catch {
        // Label might not be present
      }
    }
    results.push('Removed gate labels')

    return NextResponse.json({ success: true, results })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Cody] Approve error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
