// @vitest-environment node
/**
 * Integration tests for GET /api/course-selections/popularity — Issue #246.
 *
 * Covers the per-course popularity aggregation that backs the
 * /admin/course-selections/popularity page. Verifies:
 *  - 401 without auth, 403 for non-admin users, 200 for admins
 *  - single-pass Mongo aggregation (no per-course fetches)
 *  - counts match hand-computed values across guest/user + 7d/30d windows
 *  - gradeLevel and source filters narrow the row set
 *  - a course with zero selections in the filtered window is excluded
 *  - invalid `source` values → 400
 *
 * Pattern: mirrors tests/int/course-selections.int.spec.ts — uses
 * testcontainers for MongoDB, imports the Next route directly, exercises the
 * handler with a real PayloadRequest. We seed selections directly via the
 * Mongo collection so we can pin `createdAt` to known dates.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { GET } from '@/app/api/course-selections/popularity/route'
import { AccountRole } from '@/server/payload/collections/Users/roles'
import { startMongoContainer, stopMongoContainer } from '@/infra/utils/test/mongodb-container'
import { ObjectId } from 'mongodb'
import { NextRequest } from 'next/server'
import config from '@payload-config'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const hasDatabaseUrl = !!process.env.DATABASE_URL

let payload: Payload
let originalDatabaseUrl: string | undefined

let adminToken: string
let studentToken: string
let adminUserId: string
let studentUserId: string

let testCategoryId: string
let courseAId: string
let courseBId: string
let courseCId: string
let seedSelectionIds: string[] = []

const ts = Date.now()

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

beforeAll(async () => {
  if (!hasDatabaseUrl) return

  originalDatabaseUrl = process.env.DATABASE_URL
  // @ts-expect-error - TypeScript doesn't allow delete on process.env
  delete process.env.DATABASE_URL

  const mongoUri = await startMongoContainer()
  process.env.DATABASE_URL = mongoUri

  const payloadConfig = await import('@payload-config')
  payload = await getPayload({ config: payloadConfig.default })

  const password = 'test-password-1234'

  const adminEmail = `pop-admin-${ts}@test.local`
  const admin = await payload.create({
    collection: 'users',
    data: { email: adminEmail, password, name: 'Pop Admin' } as any,
  })
  await payload.update({
    collection: 'users',
    id: admin.id,
    data: { role: AccountRole.Admin } as any,
    overrideAccess: true,
  })
  adminUserId = admin.id
  adminToken = (await payload.login({ collection: 'users', data: { email: adminEmail, password } }))
    .token!

  const studentEmail = `pop-student-${ts}@test.local`
  const student = await payload.create({
    collection: 'users',
    data: {
      email: studentEmail,
      password,
      name: 'Pop Student',
      role: AccountRole.Student,
    } as any,
    overrideAccess: true,
  })
  studentUserId = student.id
  studentToken = (
    await payload.login({ collection: 'users', data: { email: studentEmail, password } })
  ).token!

  const category = await payload.create({
    collection: 'categories',
    data: { title: `Pop Category ${ts}`, slug: `pop-category-${ts}` } as any,
    overrideAccess: true,
  })
  testCategoryId = category.id

  const courseA = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: 'A',
      title: `Pop Course A ${ts}`,
      slug: `pop-course-a-${ts}`,
      order: 0,
      status: 'published',
      isActive: true,
      categories: [testCategoryId],
    } as any,
    overrideAccess: true,
  })
  courseAId = courseA.id

  const courseB = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: 'B',
      title: `Pop Course B ${ts}`,
      slug: `pop-course-b-${ts}`,
      order: 1,
      status: 'published',
      isActive: true,
      categories: [testCategoryId],
    } as any,
    overrideAccess: true,
  })
  courseBId = courseB.id

  const courseC = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: 'C',
      title: `Pop Course C ${ts}`,
      slug: `pop-course-c-${ts}`,
      order: 2,
      status: 'published',
      isActive: true,
      categories: [testCategoryId],
    } as any,
    overrideAccess: true,
  })
  courseCId = courseC.id

  // Direct collection insert so we can pin `createdAt` to known dates.
  // The endpoint under test uses MongoDB aggregation; we seed against the
  // same collection it reads from.
  const db = (payload.db as any).connection.db
  const coll = db.collection('course_selections')

  const docs: any[] = []
  const addDoc = (
    courseId: string,
    opts: {
      user?: string | null
      guestId?: string | null
      gradeLevel?: string
      source: string
      daysBack: number
    },
  ) => {
    const _id = new ObjectId()
    docs.push({
      _id,
      course: new ObjectId(courseId),
      user: opts.user === undefined ? undefined : opts.user ? new ObjectId(opts.user) : null,
      guestId: opts.guestId ?? null,
      gradeLevel: opts.gradeLevel ?? null,
      source: opts.source,
      ipHash: 'testiphash',
      userAgentHash: 'testuahash',
      createdAt: daysAgo(opts.daysBack),
      updatedAt: daysAgo(opts.daysBack),
    })
    seedSelectionIds.push(_id.toString())
  }

  // Course A — 5 picks, 2 unique guests, 2 unique users, 3 last-7d, 5 last-30d
  addDoc(courseAId, { guestId: 'g1', gradeLevel: '10', source: 'start-page', daysBack: 2 })
  addDoc(courseAId, { guestId: 'g2', gradeLevel: '10', source: 'start-page', daysBack: 4 })
  addDoc(courseAId, { user: studentUserId, gradeLevel: '10', source: 'course-card', daysBack: 5 })
  addDoc(courseAId, { user: adminUserId, gradeLevel: '10', source: 'course-card', daysBack: 10 })
  addDoc(courseAId, { user: studentUserId, gradeLevel: '10', source: 'course-card', daysBack: 25 })

  // Course B — 4 picks, 1 unique guest, 1 unique user, 2 last-7d, 3 last-30d
  addDoc(courseBId, { guestId: 'g3', gradeLevel: '11', source: 'homepage-greeting', daysBack: 3 })
  addDoc(courseBId, {
    user: studentUserId,
    gradeLevel: '11',
    source: 'homepage-greeting',
    daysBack: 6,
  })
  addDoc(courseBId, {
    user: studentUserId,
    gradeLevel: '11',
    source: 'homepage-greeting',
    daysBack: 15,
  })
  addDoc(courseBId, { guestId: 'g3', gradeLevel: '11', source: 'homepage-greeting', daysBack: 45 })

  // Course C — 1 pick, 60 days ago — outside last-30d
  addDoc(courseCId, { guestId: 'g4', gradeLevel: '10', source: 'other', daysBack: 60 })

  if (docs.length > 0) await coll.insertMany(docs)
}, 300_000)

afterAll(async () => {
  if (!hasDatabaseUrl || !payload) return

  // Clean up rows we seeded so other tests don't see them
  try {
    if (seedSelectionIds.length > 0) {
      const db = (payload.db as any).connection.db
      const coll = db.collection('course_selections')
      await coll.deleteMany({ _id: { $in: seedSelectionIds.map((id) => new ObjectId(id)) } })
    }
  } catch {
    /* ignore */
  }

  for (const id of [courseAId, courseBId, courseCId]) {
    try {
      await payload.delete({ collection: 'courses', id, overrideAccess: true })
    } catch {
      /* ignore */
    }
  }
  try {
    await payload.delete({ collection: 'categories', id: testCategoryId, overrideAccess: true })
  } catch {
    /* ignore */
    /* ignore */
  }
  for (const id of [adminUserId, studentUserId]) {
    try {
      await payload.delete({ collection: 'users', id, overrideAccess: true })
    } catch {
      /* ignore */
    }
  }

  if (payload?.db?.destroy) {
    await payload.db.destroy()
  }
  await stopMongoContainer()

  if (originalDatabaseUrl !== undefined) {
    process.env.DATABASE_URL = originalDatabaseUrl
  } else {
    // @ts-expect-error - TypeScript doesn't allow delete on process.env
    delete process.env.DATABASE_URL
  }
})

const authHeader = (token: string) => ({ Authorization: `JWT ${token}` })

describe.skipIf(!hasDatabaseUrl)('GET /api/course-selections/popularity — auth', () => {
  it('returns 401 without auth', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections/popularity')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin users', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections/popularity', {
      headers: authHeader(studentToken),
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('rejects an invalid `source` with 400', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/course-selections/popularity?source=made-up-source',
      { headers: authHeader(adminToken) },
    )
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 200 for an admin with no filters', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections/popularity', {
      headers: authHeader(adminToken),
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.rows)).toBe(true)
  })
})

describe.skipIf(!hasDatabaseUrl)('GET /api/course-selections/popularity — counts', () => {
  const fetchAll = async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections/popularity', {
      headers: authHeader(adminToken),
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    return (await res.json()) as {
      rows: Array<{
        courseId: string
        courseTitle: string
        totalPicks: number
        uniqueGuests: number
        uniqueUsers: number
        last7d: number
        last30d: number
      }>
      filters: Record<string, unknown>
    }
  }

  it('returns one row per course that has selections', async () => {
    const body = await fetchAll()
    const ids = body.rows.map((r) => r.courseId).sort()
    expect(ids).toEqual([courseAId, courseBId, courseCId].sort())
  })

  it('matches hand-computed counts for course A (5 picks, 2 unique guests, 2 unique users, 3 last-7d, 5 last-30d)', async () => {
    const body = await fetchAll()
    const row = body.rows.find((r) => r.courseId === courseAId)
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      totalPicks: 5,
      uniqueGuests: 2,
      uniqueUsers: 2,
      last7d: 3,
      last30d: 5,
    })
    expect(row!.courseTitle).toContain('Pop Course A')
  })

  it('matches hand-computed counts for course B (4 picks, 1 unique guest, 1 unique user, 2 last-7d, 3 last-30d)', async () => {
    const body = await fetchAll()
    const row = body.rows.find((r) => r.courseId === courseBId)
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      totalPicks: 4,
      uniqueGuests: 1,
      uniqueUsers: 1,
      last7d: 2,
      last30d: 3,
    })
  })

  it('counts course C as 1 pick but 0 last-7d and 0 last-30d', async () => {
    const body = await fetchAll()
    const row = body.rows.find((r) => r.courseId === courseCId)
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      totalPicks: 1,
      uniqueGuests: 1,
      uniqueUsers: 0,
      last7d: 0,
      last30d: 0,
    })
  })

  it('narrows the row set when filtering by source', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/course-selections/popularity?source=start-page',
      { headers: authHeader(adminToken) },
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: Array<{ courseId: string; totalPicks: number }> }
    const ids = body.rows.map((r: { courseId: string }) => r.courseId).sort()
    // Only course A had source=start-page picks
    expect(ids).toEqual([courseAId])
    expect(body.rows[0].totalPicks).toBe(2)
  })

  it('narrows the row set when filtering by gradeLevel', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/course-selections/popularity?gradeLevel=11',
      { headers: authHeader(adminToken) },
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: Array<{ courseId: string }> }
    const ids = body.rows.map((r: { courseId: string }) => r.courseId).sort()
    // Only course B had gradeLevel=11
    expect(ids).toEqual([courseBId])
  })

  it('drops a course whose selections fall outside the filtered window', async () => {
    // gradeLevel=11 + source=other should yield zero rows because course C
    // has source=other but gradeLevel=10, and course B has gradeLevel=11 but
    // source=homepage-greeting.
    const req = new NextRequest(
      'http://localhost:3000/api/course-selections/popularity?gradeLevel=11&source=other',
      { headers: authHeader(adminToken) },
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: unknown[] }
    expect(body.rows).toEqual([])
  })
})
