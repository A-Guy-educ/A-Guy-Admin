/**
 * Backfill Users.currentCourse from historical signals.
 *
 * For every user without currentCourse set, pick the "most recent" course from:
 *   - course-selections (most recent authenticated row, by createdAt desc)
 *   - Users.courseEntitlements (most recent entry, by grantedAt desc)
 * Whichever is newer wins. Skip users with no signal.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/backfill-user-current-course.ts
 *   npx tsx scripts/backfill-user-current-course.ts --dry-run
 *   npx tsx scripts/backfill-user-current-course.ts --limit 100
 */
import { getPayload } from 'payload'
import config from '@payload-config'

type Payload = Awaited<ReturnType<typeof getPayload>>

const DRY_RUN = process.argv.includes('--dry-run')

function parseLimit(): number {
  const idx = process.argv.indexOf('--limit')
  if (idx === -1) return 100000
  const val = parseInt(process.argv[idx + 1] ?? '', 10)
  return Number.isFinite(val) && val > 0 ? val : 100000
}

async function latestSelectionCourseId(
  payload: Payload,
  userId: string,
): Promise<{ courseId: string; at: Date } | null> {
  const res = await payload.find({
    collection: 'course-selections',
    where: { user: { equals: userId } },
    sort: '-createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
    select: { course: true, createdAt: true },
  })
  const doc = res.docs[0]
  if (!doc) return null
  const courseId = typeof doc.course === 'string' ? doc.course : doc.course?.id
  if (!courseId) return null
  return { courseId, at: new Date(doc.createdAt) }
}

function latestEntitlementCourseId(entitlements: unknown): { courseId: string; at: Date } | null {
  if (!Array.isArray(entitlements) || entitlements.length === 0) return null

  let best: { courseId: string; at: Date } | null = null
  for (const entry of entitlements as Array<{
    course?: string | { id: string }
    grantedAt?: string
  }>) {
    const courseId = typeof entry.course === 'string' ? entry.course : entry.course?.id
    if (!courseId) continue
    const at = entry.grantedAt ? new Date(entry.grantedAt) : new Date(0)
    if (!best || at.getTime() > best.at.getTime()) {
      best = { courseId, at }
    }
  }
  return best
}

async function main() {
  const limit = parseLimit()
  console.log(
    `[backfill-user-current-course] Starting${DRY_RUN ? ' (dry-run)' : ''}, limit=${limit}`,
  )

  const payload = await getPayload({ config })

  const users = await payload.find({
    collection: 'users',
    where: { currentCourse: { exists: false } },
    limit,
    depth: 0,
    overrideAccess: true,
    select: { courseEntitlements: true, currentCourse: true },
  })

  const total = users.docs.length
  console.log(`[backfill-user-current-course] ${total} candidate users (currentCourse unset)`)

  let populated = 0
  let skipped = 0
  let failed = 0

  for (const user of users.docs) {
    if (user.currentCourse) {
      skipped++
      continue
    }

    const [fromSelection, fromEntitlement] = await Promise.all([
      latestSelectionCourseId(payload, user.id),
      Promise.resolve(
        latestEntitlementCourseId((user as { courseEntitlements?: unknown }).courseEntitlements),
      ),
    ])

    let pick: { courseId: string; at: Date } | null = null
    if (fromSelection && fromEntitlement) {
      pick =
        fromSelection.at.getTime() >= fromEntitlement.at.getTime() ? fromSelection : fromEntitlement
    } else {
      pick = fromSelection ?? fromEntitlement
    }

    if (!pick) {
      skipped++
      continue
    }

    if (DRY_RUN) {
      populated++
      console.log(
        `  [dry-run] user=${user.id} -> course=${pick.courseId} (source=${
          fromSelection && pick === fromSelection ? 'course-selection' : 'entitlement'
        }, at=${pick.at.toISOString()})`,
      )
      continue
    }

    try {
      await payload.update({
        collection: 'users',
        id: user.id,
        data: { currentCourse: pick.courseId },
        overrideAccess: true,
        depth: 0,
      })
      populated++
    } catch (err) {
      failed++
      console.error(`  Failed to update user ${user.id}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(
    `\n[backfill-user-current-course] Populated ${populated} of ${total} users (${skipped} skipped no signal, ${failed} failed)`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
