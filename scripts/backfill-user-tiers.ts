/**
 * Backfill user.currentTier for every existing user.
 *
 * Run this AFTER scripts/seed-tiers.ts (or after the four tier rows
 * exist) and BEFORE deploying anything that gates on `user.currentTier`.
 * Without this, existing users have `currentTier` unset until an
 * unrelated entitlement event fires their afterChange hook — meaning
 * paid users show as untiered to any gate that reads the field.
 *
 * Idempotent + resumable — recomputeUserTier is safe to call on any
 * user any number of times. If the script dies partway through,
 * re-run it and it will simply recompute everyone again.
 *
 * Usage: npx tsx scripts/backfill-user-tiers.ts
 */
import { getPayload } from 'payload'
import config from '@payload-config'

import { recomputeUserTier } from '@/lib/payment/recompute-tier'

const PAGE_SIZE = 100

async function main() {
  const payload = await getPayload({ config })

  // Verify the seed ran — no default tier means recompute leaves
  // untouched users at currentTier=null (with a warn log per user).
  // Better to fail fast here than emit hundreds of warn lines.
  const defaults = await payload.find({
    collection: 'tiers',
    where: { isDefault: { equals: true } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (defaults.docs.length === 0) {
    console.error('No default (isDefault=true) tier is seeded. Run scripts/seed-tiers.ts first.')
    process.exit(2)
  }

  let page = 1
  let processed = 0
  let promoted = 0
  let unchanged = 0
  let failed = 0

  for (;;) {
    const batch = await payload.find({
      collection: 'users',
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
      sort: 'id',
    })

    if (batch.docs.length === 0) break

    for (const doc of batch.docs) {
      const user = doc as { id: string; currentTier?: string | { id: string } | null }
      const before =
        typeof user.currentTier === 'object' && user.currentTier
          ? user.currentTier.id
          : (user.currentTier ?? null)

      try {
        await recomputeUserTier(payload, user.id)
        processed++
      } catch (err) {
        failed++
        payload.logger.error(
          { err: err instanceof Error ? err.message : String(err), userId: user.id },
          '[backfill-user-tiers] recompute failed for user',
        )
        continue
      }

      const after = (await payload.findByID({
        collection: 'users',
        id: user.id,
        depth: 0,
        overrideAccess: true,
      })) as { currentTier?: string | { id: string } | null }
      const afterId =
        typeof after.currentTier === 'object' && after.currentTier
          ? after.currentTier.id
          : (after.currentTier ?? null)

      if (String(before ?? '') !== String(afterId ?? '')) {
        promoted++
      } else {
        unchanged++
      }
    }

    if (batch.hasNextPage) {
      page++
    } else {
      break
    }
  }

  payload.logger.info({ processed, promoted, unchanged, failed }, '[backfill-user-tiers] done')
  console.log(
    `[backfill-user-tiers] processed=${processed} promoted=${promoted} unchanged=${unchanged} failed=${failed}`,
  )
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Failed to backfill user tiers:', err)
  process.exit(1)
})
