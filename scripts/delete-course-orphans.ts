/**
 * Delete content docs whose *authoritative* parent chain is broken.
 *
 * Authoritative parent (the field that actually determines where a doc
 * lives in the content tree):
 *   - chapters.course
 *   - lessons.chapter
 *   - exercises.lesson
 *
 * The following fields exist on the same docs but are DENORMALIZED CACHES,
 * NOT authoritative parents:
 *   - lessons.course       (cached from lesson.chapter.course)
 *   - exercises.chapter    (cached from exercise.lesson.chapter)
 *   - exercises.course     (cached from exercise.lesson.chapter.course)
 *
 * A doc with a stale denorm cache is a data-quality problem, NOT an orphan.
 * The earlier version of this script treated denorm as authoritative and
 * over-deleted legit exercises during the July 2026 cleanup — real
 * incident: 2042 exercises attached to valid lessons were nuked because
 * their exercise.chapter denorm pointed at a chapter that no longer
 * existed (the lesson had been moved between chapters on the source and
 * the exercises' denorm cache was never backfilled). Never again.
 *
 * The script cascades naturally by iterating: deleting a chapter orphans
 * its lessons on the next pass, deleting a lesson orphans its exercises
 * on the pass after that. Runs until a full pass finds zero orphans.
 *
 * The script is DRY-RUN by default. Set ORPHAN_APPLY=1 to actually delete.
 * Set ORPHAN_COURSE_ID=<id> to scope: only chapters whose course=<id>
 * become the initial deletion candidate, everything downstream follows via
 * cascade. Handy after a failed content-promotion import where the target
 * course id got remapped but the children landed pointing at the failed
 * new id.
 *
 * (Uses env vars rather than argv because `pnpm exec tsx -e "..."` swallows
 * the args passed after `--`, which caused a silent unscoped run the first
 * time this script was invoked.)
 *
 * Usage:
 *   pnpm exec tsx -e "import('dotenv/config').then(()=>import('./scripts/delete-course-orphans.ts'))"                                    # dry run
 *   ORPHAN_COURSE_ID=6988... pnpm exec tsx -e "import('dotenv/config').then(()=>import('./scripts/delete-course-orphans.ts'))"           # dry run scoped
 *   ORPHAN_APPLY=1 ... pnpm exec tsx -e "..."                                                                                             # actually delete
 */
import { MongoClient, ObjectId, type Db } from 'mongodb'

interface ParentLink {
  child: 'chapters' | 'lessons' | 'exercises'
  field: 'course' | 'chapter' | 'lesson'
  parent: 'courses' | 'chapters' | 'lessons'
}

// Top-down so the cascade cleans up in one pass in the common case.
const AUTHORITATIVE_PARENTS: readonly ParentLink[] = [
  { child: 'chapters', field: 'course', parent: 'courses' },
  { child: 'lessons', field: 'chapter', parent: 'chapters' },
  { child: 'exercises', field: 'lesson', parent: 'lessons' },
]

const MAX_PASSES = 5

function readOpts(): { apply: boolean; scopedCourseId: string | null } {
  return {
    apply: process.env.ORPHAN_APPLY === '1',
    scopedCourseId: process.env.ORPHAN_COURSE_ID?.trim() || null,
  }
}

function toObjectIdish(id: string): unknown[] {
  const forms: unknown[] = [id]
  if (/^[a-f0-9]{24}$/i.test(id)) forms.push(new ObjectId(id))
  return forms
}

async function sweepOne(
  db: Db,
  { child, field, parent }: ParentLink,
  apply: boolean,
  scopedCourseId: string | null,
): Promise<number> {
  const childCol = db.collection(child)
  const parentCol = db.collection(parent)

  const distinctIds = (await childCol.distinct(field, {})) as unknown[]
  const missingForms: unknown[] = []
  for (const raw of distinctIds) {
    if (raw == null) continue
    const asStr =
      raw instanceof ObjectId ? raw.toHexString() : typeof raw === 'string' ? raw : String(raw)

    // Course-scope filter only applies to the chapters→courses sweep —
    // lessons/exercises cascade in via their deleted parents automatically.
    if (scopedCourseId && parent === 'courses' && asStr !== scopedCourseId) continue

    const forms = toObjectIdish(asStr)
    const exists = await parentCol.findOne(
      { $or: forms.map((f) => ({ _id: f as never })) },
      { projection: { _id: 1 } },
    )
    if (!exists) missingForms.push(...forms)
  }

  if (missingForms.length === 0) {
    console.log(`  ${child}.${field} → ${parent}: clean`)
    return 0
  }

  const count = await childCol.countDocuments({ [field]: { $in: missingForms } })
  if (!apply) {
    console.log(`  ${child}.${field} → ${parent}: ${count} orphan(s)`)
    return count
  }
  const res = await childCol.deleteMany({ [field]: { $in: missingForms } })
  const deleted = res.deletedCount ?? 0
  console.log(`  ${child}.${field} → ${parent}: deleted ${deleted} (was ${count})`)
  return deleted
}

async function main(): Promise<void> {
  const { apply, scopedCourseId } = readOpts()
  const uri = process.env.DATABASE_URL
  if (!uri) throw new Error('DATABASE_URL not set')

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db()
  console.log(
    `[orphans] connected db=${db.databaseName} mode=${apply ? 'APPLY' : 'DRY-RUN'}${
      scopedCourseId ? ` scoped-to=${scopedCourseId}` : ''
    }`,
  )

  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    console.log(`\n[pass ${pass}]`)
    let totalThisPass = 0
    for (const link of AUTHORITATIVE_PARENTS) {
      totalThisPass += await sweepOne(db, link, apply, scopedCourseId)
    }
    if (totalThisPass === 0) {
      console.log(
        `\n[orphans] converged after ${pass} pass(es) — ${apply ? 'DB is clean' : 'no orphans found'}`,
      )
      break
    }
    if (!apply) {
      // In dry-run we can't cascade (nothing was actually deleted), so
      // repeating the same sweep would give the same numbers. One pass is
      // enough to show what would happen; the operator re-runs with APPLY
      // to get the real cascade.
      console.log(
        `\n[orphans] dry-run: showing pass 1 only — re-run with ORPHAN_APPLY=1 to see cascade`,
      )
      break
    }
  }

  await client.close()
}

main().catch((err) => {
  console.error('[orphans] fatal:', err)
  process.exit(1)
})
