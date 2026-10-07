/**
 * Backfill user.currentTier to the hardcoded default ('free') for every user
 * whose value is unset, non-string, or not one of the four allowed slugs.
 *
 * Run once after switching currentTier from a relationship to the hardcoded
 * select enum (see parent-folder TIERS.md). Without this, pre-migration users
 * carry a Mongo ObjectId string in `currentTier` which fails the select
 * field's option validation on first admin save.
 *
 * Idempotent + resumable. Only touches users whose current value is invalid;
 * users already on a valid slug are skipped.
 *
 * Usage: npx tsx scripts/backfill-user-tiers-flat.ts
 */
import { getPayload } from 'payload'
import config from '@payload-config'

import { DEFAULT_TIER, isTierSlug } from '@/lib/tiers/constants'

const PAGE_SIZE = 100

async function main() {
  const payload = await getPayload({ config })

  let page = 1
  let processed = 0
  let updated = 0
  let skipped = 0
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
      processed++
      const user = doc as { id: string; currentTier?: unknown }
      const current =
        typeof user.currentTier === 'object' && user.currentTier
          ? (user.currentTier as { id?: unknown }).id
          : user.currentTier

      if (isTierSlug(current)) {
        skipped++
        continue
      }

      try {
        await payload.update({
          collection: 'users',
          id: user.id,
          data: { currentTier: DEFAULT_TIER },
          overrideAccess: true,
        })
        updated++
      } catch (err) {
        failed++
        payload.logger.error(
          { err: err instanceof Error ? err.message : String(err), userId: user.id },
          '[backfill-user-tiers-flat] update failed for user',
        )
      }
    }

    if (batch.hasNextPage) {
      page++
    } else {
      break
    }
  }

  payload.logger.info(
    { processed, updated, skipped, failed },
    '[backfill-user-tiers-flat] done',
  )
  console.log(
    `[backfill-user-tiers-flat] processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`,
  )
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Failed to backfill user tiers (flat):', err)
  process.exit(1)
})
