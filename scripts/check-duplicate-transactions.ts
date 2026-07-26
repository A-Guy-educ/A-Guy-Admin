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
 * Connects with the raw driver rather than booting Payload: this is a
 * read-only diagnostic and should not depend on blob storage, plugins, or any
 * other boot-time requirement. It never writes.
 *
 * Exits 0 when clean, 1 when duplicates are found (usable as a CI gate).
 *
 * Usage: pnpm tsx scripts/check-duplicate-transactions.ts
 */
import 'dotenv/config'
import { MongoClient } from 'mongodb'

interface DuplicateGroup {
  _id: { provider: string | null; providerTransactionId: string | null }
  count: number
  ids: unknown[]
  statuses: (string | null)[]
  grantedAt: (Date | string | null)[]
}

/** Strip credentials so the target is loggable. */
function describeTarget(uri: string): string {
  try {
    const parsed = new URL(uri)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return '(unparseable connection string)'
  }
}

async function main() {
  const uri = process.env.DATABASE_URL || process.env.DATABASE_URI
  if (!uri) {
    process.stderr.write('DATABASE_URL is not set.\n')
    process.exit(2)
  }

  const client = new MongoClient(uri)
  await client.connect()

  try {
    const collection = client.db().collection('transactions')

    process.stdout.write(`Target: ${describeTarget(uri)}\n`)
    process.stdout.write('Scanning for duplicate (provider, providerTransactionId)...\n')

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
      return 0
    }

    const affected = groups.reduce((sum, g) => sum + g.count, 0)
    process.stdout.write(
      `\n❌ ${groups.length} duplicated provider IDs covering ${affected} of ${total} transactions.\n\n`,
    )

    for (const group of groups) {
      const { provider, providerTransactionId } = group._id
      process.stdout.write(
        `${provider ?? '(no provider)'} / ${providerTransactionId ?? '(null)'}\n`,
      )
      process.stdout.write(`  rows:     ${group.count}\n`)
      process.stdout.write(`  ids:      ${group.ids.map(String).join(', ')}\n`)
      process.stdout.write(`  statuses: ${group.statuses.map((s) => s ?? '—').join(', ')}\n`)
      // The row carrying entitlementsGrantedAt is the one the grant path
      // already acted on — normally the one to keep.
      process.stdout.write(
        `  granted:  ${group.grantedAt.map((d) => (d ? new Date(d).toISOString() : '—')).join(', ')}\n\n`,
      )
    }

    process.stdout.write('Resolve these before making the index unique.\n')
    return 1
  } finally {
    await client.close()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exit(2)
  })
