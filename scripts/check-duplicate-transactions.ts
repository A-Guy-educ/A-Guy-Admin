/**
 * Check for duplicate transactions before adding a unique index.
 *
 * `Transactions.providerTransactionId` is indexed but not unique, and both
 * webhook handlers resolve a transaction by it with `limit: 1`. If duplicates
 * exist, a replayed webhook can pick an arbitrary row, so the idempotency
 * flags (`entitlementsGrantedAt`, `couponConsumedAt`) land on the wrong doc.
 *
 * The fix is a unique index on (provider, providerTransactionId) — but adding
 * one to a collection that already contains duplicates makes the background
 * index build fail, and Mongo reports that only in the server log. Run this
 * first.
 *
 * Read-only: this script never writes. Deduping is a separate, manual decision
 * because the right row to keep depends on which one carries the grant flags.
 *
 * Exits 0 when clean, 1 when duplicates are found (usable as a CI gate).
 *
 * Usage: pnpm tsx scripts/check-duplicate-transactions.ts
 */
import { getPayload } from 'payload'

import config from '@payload-config'

interface DuplicateGroup {
  _id: { provider: string | null; providerTransactionId: string | null }
  count: number
  ids: string[]
  statuses: string[]
  grantedAt: (string | null)[]
}

async function main() {
  const payload = await getPayload({ config })

  process.stdout.write('Scanning transactions for duplicate (provider, providerTransactionId)...\n')

  const collection = payload.db.collections.transactions?.collection
  if (!collection) {
    process.stderr.write('Could not reach the transactions collection.\n')
    process.exit(2)
  }

  const groups = (await collection
    .aggregate([
      {
        $group: {
          _id: { provider: '$provider', providerTransactionId: '$providerTransactionId' },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
          statuses: { $push: '$status' },
          grantedAt: { $push: '$entitlementsGrantedAt' },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray()) as unknown as DuplicateGroup[]

  const total = await collection.countDocuments()

  if (groups.length === 0) {
    process.stdout.write(`\n✅ No duplicates across ${total} transactions.\n`)
    process.stdout.write('Safe to make the (provider, providerTransactionId) index unique:\n')
    process.stdout.write("  { fields: ['provider', 'providerTransactionId'], unique: true }\n")
    process.exit(0)
  }

  const affected = groups.reduce((sum, g) => sum + g.count, 0)
  process.stdout.write(
    `\n❌ ${groups.length} duplicated provider IDs covering ${affected} of ${total} transactions.\n\n`,
  )

  for (const group of groups) {
    const { provider, providerTransactionId } = group._id
    process.stdout.write(`${provider ?? '(no provider)'} / ${providerTransactionId ?? '(null)'}\n`)
    process.stdout.write(`  rows:     ${group.count}\n`)
    process.stdout.write(`  ids:      ${group.ids.join(', ')}\n`)
    process.stdout.write(`  statuses: ${group.statuses.join(', ')}\n`)
    // The row carrying entitlementsGrantedAt is the one the grant path already
    // acted on — normally the one to keep.
    process.stdout.write(`  granted:  ${group.grantedAt.map((d) => d ?? '—').join(', ')}\n\n`)
  }

  process.stdout.write('Resolve these before making the index unique.\n')
  process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(2)
})
