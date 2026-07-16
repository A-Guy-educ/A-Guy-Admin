/**
 * Delete chapters, lessons, and exercises whose `course` field points at a
 * course id that doesn't exist on the target DB.
 *
 * Motivation: when a content-promotion import fails to create the course
 * (e.g. the stale $jsonSchema validator issue that this repo also carries a
 * migration for), the child collections still get inserted with their
 * source-side `course` id. On the target that id has no matching doc, so
 * those children are unreachable via any admin listing filtered by course.
 * Re-importing the same bundle after fixing the course-side issue would
 * spawn a second, remapped set of children (id collisions on the orphans),
 * leaving both dangling and duplicated. Cleaner to nuke the orphans first.
 *
 * The script is DRY-RUN by default. Set ORPHAN_APPLY=1 to actually delete.
 * Pass ORPHAN_COURSE_ID=<id> to narrow to a single course's orphans.
 *
 * (Uses env vars rather than argv because `pnpm exec tsx -e "..."` swallows
 * the args passed after `--`, which caused a silent unscoped run the first
 * time this script was invoked.)
 *
 * Usage:
 *   pnpm exec tsx -e "import('dotenv/config').then(()=>import('./scripts/delete-course-orphans.ts'))"                          # dry run, all missing courses
 *   ORPHAN_COURSE_ID=6988... pnpm exec tsx -e "import('dotenv/config').then(()=>import('./scripts/delete-course-orphans.ts'))" # dry run scoped to one course
 *   ORPHAN_APPLY=1 ... pnpm exec tsx -e "..."                                                                                   # actually delete
 */
import { MongoClient, ObjectId } from 'mongodb'

const CHILD_COLLECTIONS = ['chapters', 'lessons', 'exercises'] as const
type ChildCollection = (typeof CHILD_COLLECTIONS)[number]

function readOpts(): { apply: boolean; courseId: string | null } {
  return {
    apply: process.env.ORPHAN_APPLY === '1',
    courseId: process.env.ORPHAN_COURSE_ID?.trim() || null,
  }
}

function toObjectIdish(id: string): unknown[] {
  const forms: unknown[] = [id]
  if (/^[a-f0-9]{24}$/i.test(id)) forms.push(new ObjectId(id))
  return forms
}

async function main(): Promise<void> {
  const { apply, courseId } = readOpts()
  const uri = process.env.DATABASE_URL
  if (!uri) throw new Error('DATABASE_URL not set')

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db()
  console.log(
    `[orphans] connected db=${db.databaseName} mode=${apply ? 'APPLY' : 'DRY-RUN'}${
      courseId ? ` scoped-to=${courseId}` : ''
    }`,
  )

  const coursesCol = db.collection('courses')
  const missingCourseIds = new Set<string>()

  const perCollection: Record<ChildCollection, number> = { chapters: 0, lessons: 0, exercises: 0 }

  for (const collName of CHILD_COLLECTIONS) {
    const col = db.collection(collName)
    const distinctCourses = (await col.distinct('course', {})) as unknown[]
    for (const raw of distinctCourses) {
      if (raw == null) continue
      const asStr =
        raw instanceof ObjectId ? raw.toHexString() : typeof raw === 'string' ? raw : String(raw)
      if (courseId && asStr !== courseId) continue
      const forms = toObjectIdish(asStr)
      const existing = await coursesCol.findOne(
        { $or: forms.map((f) => ({ _id: f as never })) },
        { projection: { _id: 1 } },
      )
      if (!existing) missingCourseIds.add(asStr)
    }

    let matched = 0
    for (const missing of missingCourseIds) {
      const forms = toObjectIdish(missing)
      const q = { course: { $in: forms } }
      const count = await col.countDocuments(q)
      matched += count
    }
    perCollection[collName] = matched
    console.log(`[orphans] ${collName}: ${matched} orphan doc(s) referencing missing course(s)`)

    if (apply && matched > 0) {
      let deleted = 0
      for (const missing of missingCourseIds) {
        const forms = toObjectIdish(missing)
        const res = await col.deleteMany({ course: { $in: forms } })
        deleted += res.deletedCount ?? 0
      }
      console.log(`[orphans] ${collName}: deleted ${deleted}`)
    }
  }

  console.log('\n[orphans] summary:')
  console.log(`  missing course ids: ${[...missingCourseIds].join(', ') || '(none)'}`)
  for (const c of CHILD_COLLECTIONS) console.log(`  ${c}: ${perCollection[c]}`)
  console.log(`  mode: ${apply ? 'APPLIED' : 'DRY-RUN — re-run with ORPHAN_APPLY=1 to delete'}`)

  await client.close()
}

main().catch((err) => {
  console.error('[orphans] fatal:', err)
  process.exit(1)
})
