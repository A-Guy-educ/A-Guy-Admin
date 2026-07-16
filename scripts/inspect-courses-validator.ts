/**
 * One-shot diagnostic: list every collection with a `$jsonSchema` validator
 * attached on the target DB, and dump the validator so we can see which
 * fields it demands. Used to catch stale required-field lists that reject
 * legitimate inserts (see PR for `dropStaleCoursesValidator` migration).
 *
 * Usage:  pnpm exec tsx -e "import('dotenv/config').then(()=>import('./scripts/inspect-courses-validator.ts'))"
 */
import { MongoClient } from 'mongodb'

async function main(): Promise<void> {
  const uri = process.env.DATABASE_URL
  if (!uri) throw new Error('DATABASE_URL not set')

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db()
  console.log(`[inspect] connected to db=${db.databaseName}`)

  const all = await db.listCollections({}, { nameOnly: false }).toArray()
  const withValidator = all.filter((c) => c.options?.validator)
  console.log(
    `[inspect] ${all.length} collections total, ${withValidator.length} with a validator\n`,
  )

  for (const c of withValidator) {
    console.log(`── ${c.name} ──`)
    console.log(JSON.stringify(c.options, null, 2))
    console.log()
  }

  if (withValidator.length === 0) {
    console.log('[inspect] no collection-level validators anywhere — nothing stale to clean up')
  }

  await client.close()
}

main().catch((err) => {
  console.error('[inspect] fatal:', err)
  process.exit(1)
})
