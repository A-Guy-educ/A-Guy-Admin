/**
 * Migrate course pageAccessType → 'mandatory'
 *
 * Sets pageAccessType to 'mandatory' on every course document regardless of
 * its previous value. Idempotent — courses already on 'mandatory' are
 * skipped via a `not_equals` filter.
 *
 * The Admin schema change that removes the pageAccessType field ships in a
 * later deploy (see Courses.ts). This script MUST be run in production
 * BEFORE that deploy lands, so no course is left with a stale value during
 * the rollout window.
 *
 * Usage: pnpm tsx scripts/migrate-course-page-access-to-mandatory.ts
 */
import { getPayload } from 'payload'

import config from '@payload-config'

const TARGET_VALUE = 'mandatory'
const BATCH_SIZE = 200

async function main() {
  const payload = await getPayload({ config })

  const { totalDocs } = await payload.count({
    collection: 'courses',
    where: { pageAccessType: { not_equals: TARGET_VALUE } },
    overrideAccess: true,
  })

  console.log(`Found ${totalDocs} course(s) with pageAccessType != '${TARGET_VALUE}'`)

  if (totalDocs === 0) {
    console.log('Nothing to migrate.')
    return
  }

  let processed = 0
  let page = 1

  while (processed < totalDocs) {
    const batch = await payload.find({
      collection: 'courses',
      where: { pageAccessType: { not_equals: TARGET_VALUE } },
      limit: BATCH_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
    })

    if (batch.docs.length === 0) break

    for (const course of batch.docs) {
      await payload.update({
        collection: 'courses',
        id: course.id,
        // The Courses schema drops pageAccessType in the same change set,
        // so the typed payload won't include it. Cast is intentional and
        // scoped to the migration script — the field still exists in the
        // database at the time this script is run.
        data: { pageAccessType: TARGET_VALUE } as never,
        overrideAccess: true,
      })
      processed += 1
    }

    console.log(`Processed ${processed}/${totalDocs}`)
    page += 1
  }

  console.log(`Done. Migrated ${processed} course(s) to pageAccessType='${TARGET_VALUE}'.`)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
