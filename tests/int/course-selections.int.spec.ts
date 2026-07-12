// @vitest-environment node
/**
 * Integration tests for POST /api/course-selections and the underlying
 * `logCourseSelection` endpoint handler — Issue #165.
 *
 * Covers:
 *  - anonymous happy path (guestId + course id → 200, row exists with hashed
 *    ip/ua and no user)
 *  - authenticated happy path (attaches user from req.user.id)
 *  - missing course → 400
 *  - non-existent course id → 400
 *  - non-admin GET on /api/course-selections/* → 401/403
 *
 * Pattern: mirrors tests/int/admin-dashboard-metrics.int.spec.ts. Uses
 * testcontainers for MongoDB, imports the Next route directly, exercises the
 * endpoint handler with a real PayloadRequest that talks to Mongo.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AccountRole } from '@/server/payload/collections/Users/roles'
import { POST } from '@/app/api/course-selections/route'
import { logCourseSelection } from '@/server/payload/endpoints/course-selections/log-selection'
import { startMongoContainer, stopMongoContainer } from '@/infra/utils/test/mongodb-container'
import config from '@payload-config'
import { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REST_GET = (await import('@payloadcms/next/routes')).REST_GET

const hasDatabaseUrl = !!process.env.DATABASE_URL

let payload: Payload
let originalDatabaseUrl: string | undefined

let adminToken: string
let studentToken: string
let testUserId: string

let testCategoryId: string
let testCourseId: string

const ts = Date.now()

beforeAll(async () => {
  if (!hasDatabaseUrl) return

  originalDatabaseUrl = process.env.DATABASE_URL
  // @ts-expect-error - TypeScript doesn't allow delete on process.env
  delete process.env.DATABASE_URL

  const mongoUri = await startMongoContainer()
  process.env.DATABASE_URL = mongoUri

  const payloadConfig = await import('@payload-config')
  payload = await getPayload({ config: payloadConfig.default })

  // Create an admin user
  const adminEmail = `cs-admin-${ts}@test.local`
  const admin = await payload.create({
    collection: 'users',
    data: { email: adminEmail, password: 'test-password-1234', name: 'CS Admin' } as any,
  })
  await payload.update({
    collection: 'users',
    id: admin.id,
    data: { role: AccountRole.Admin } as any,
    overrideAccess: true,
  })
  const adminLogin = await payload.login({
    collection: 'users',
    data: { email: adminEmail, password: 'test-password-1234' },
  })
  adminToken = adminLogin.token!

  // Create a non-admin user that will also be used for authenticated POST
  const studentEmail = `cs-student-${ts}@test.local`
  const student = await payload.create({
    collection: 'users',
    data: {
      email: studentEmail,
      password: 'test-password-1234',
      name: 'CS Student',
      role: AccountRole.Student,
    } as any,
    overrideAccess: true,
  })
  testUserId = student.id
  const studentLogin = await payload.login({
    collection: 'users',
    data: { email: studentEmail, password: 'test-password-1234' },
  })
  studentToken = studentLogin.token!

  // Build a minimal category + course so the endpoint has something to point at
  const category = await payload.create({
    collection: 'categories',
    data: { title: `CS Category ${ts}`, slug: `cs-category-${ts}` } as any,
    overrideAccess: true,
  })
  testCategoryId = category.id

  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: 'CS',
      title: `CS Course ${ts}`,
      slug: `cs-course-${ts}`,
      order: 0,
      status: 'published',
      isActive: true,
      categories: [testCategoryId],
    } as any,
    overrideAccess: true,
  })
  testCourseId = course.id
}, 300_000)

afterAll(async () => {
  if (!hasDatabaseUrl || !payload) return

  // Clean up rows we created so test runs don't accumulate
  try {
    const rows = await payload.find({
      collection: 'course-selections',
      limit: 1000,
      overrideAccess: true,
    })
    for (const row of rows.docs) {
      await payload
        .delete({ collection: 'course-selections', id: row.id, overrideAccess: true })
        .catch(() => {})
    }
  } catch {
    /* ignore */
  }

  try {
    if (testCourseId) {
      await payload.delete({ collection: 'courses', id: testCourseId, overrideAccess: true })
    }
    if (testCategoryId) {
      await payload.delete({ collection: 'categories', id: testCategoryId, overrideAccess: true })
    }
    if (testUserId) {
      await payload.delete({ collection: 'users', id: testUserId, overrideAccess: true })
    }
  } catch {
    /* ignore */
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

describe.skipIf(!hasDatabaseUrl)('POST /api/course-selections', () => {
  it('logs an anonymous selection (no auth, guest id, hashed fingerprints)', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.7',
        'user-agent': 'anonymous-tester/1.0',
      },
      body: JSON.stringify({
        course: testCourseId,
        source: 'start-page',
        guestId: 'guest-abc-123',
        gradeLevel: '10',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true })

    // The endpoint must NEVER echo the stored row
    expect(body).not.toHaveProperty('doc')
    expect(body).not.toHaveProperty('courseSelection')

    // Verify the row was created exactly once with hashed fingerprints
    const rows = await payload.find({
      collection: 'course-selections',
      where: { guestId: { equals: 'guest-abc-123' } },
      overrideAccess: true,
    })
    expect(rows.totalDocs).toBe(1)

    const row = rows.docs[0]
    expect(row.source).toBe('start-page')
    expect(row.gradeLevel).toBe('10')
    expect(row.user).toBeUndefined()
    expect(row.guestId).toBe('guest-abc-123')
    expect(typeof row.ipHash).toBe('string')
    expect(row.ipHash).toMatch(/^[a-f0-9]{16}$/)
    expect(row.ipHash).not.toBe('')
    expect(typeof row.userAgentHash).toBe('string')
    expect(row.userAgentHash).toMatch(/^[a-f0-9]{16}$/)
    expect(row.userAgentHash).not.toBe('')
    // The hash must NOT contain the raw IP or UA
    expect(row.ipHash).not.toContain('203.0.113')
    expect(row.userAgentHash).not.toContain('anonymous-tester')
  })

  it('attaches the authenticated user id when the request carries a JWT', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `JWT ${studentToken}`,
        'x-forwarded-for': '198.51.100.42',
        'user-agent': 'authenticated-tester/2.0',
      },
      body: JSON.stringify({
        course: testCourseId,
        source: 'homepage-greeting',
        gradeLevel: '11',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    await res.json()

    const rows = await payload.find({
      collection: 'course-selections',
      where: {
        and: [{ source: { equals: 'homepage-greeting' } }, { user: { equals: testUserId } }],
      },
      overrideAccess: true,
    })
    expect(rows.totalDocs).toBe(1)
    const row = rows.docs[0]
    const userId = typeof row.user === 'string' ? row.user : row.user?.id
    expect(userId).toBe(testUserId)
    expect(row.guestId).toBeFalsy()
  })

  it('returns 400 when the course id is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'course-card' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('returns 400 when the course id refers to a non-existent course', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course: '000000000000000000000000',
        source: 'course-card',
        guestId: 'no-course-guest',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  it('rejects payloads with an unsupported source (zod validation)', async () => {
    const req = new NextRequest('http://localhost:3000/api/course-selections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course: testCourseId,
        source: 'made-up-source',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 401/403 for non-admin GET on /api/course-selections/* via REST', async () => {
    const handler = REST_GET(config)

    const req = new Request('http://localhost:3000/api/course-selections?limit=5', {
      method: 'GET',
      headers: {
        Authorization: `JWT ${studentToken}`,
        'Content-Type': 'application/json',
      },
    })

    const res = (await handler(req, {
      params: Promise.resolve({ slug: ['course-selections'] }),
    })) as Response

    // Payload returns 403 for any unauthorized REST request (anonymous or
    // non-admin) — see tests/int/admin-transactions-rest-api.int.spec.ts
    expect([401, 403]).toContain(res.status)
  })

  it('exposes the endpoint handler to in-process callers (no Next dependency)', async () => {
    // The handler is what the Next.js route delegates to. Smoke-test it
    // directly to confirm the public API works without a Next request.
    const headers = new Headers({
      'x-forwarded-for': '192.0.2.5',
      'user-agent': 'handler-direct-tester/1.0',
    })
    const result = await logCourseSelection({
      payload,
      headers,
      json: async () => ({
        course: testCourseId,
        source: 'course-card',
        guestId: 'direct-handler-guest',
      }),
    } as any)

    expect(result.status).toBe(200)
    const body = await result.json()
    expect(body.success).toBe(true)

    const rows = await payload.find({
      collection: 'course-selections',
      where: { guestId: { equals: 'direct-handler-guest' } },
      overrideAccess: true,
    })
    expect(rows.totalDocs).toBe(1)
  })
})
