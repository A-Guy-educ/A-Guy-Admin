/**
 * Unit tests for POST/DELETE /api/users/me/course-signups.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { addCourseSignup } from '@/server/payload/endpoints/users-me-course-signups/add-course-signup'
import { removeCourseSignup } from '@/server/payload/endpoints/users-me-course-signups/remove-course-signup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SERVICE_TOKEN = 'test-service-token'
const USER_ID = 'user-1'
const COURSE_ID = 'course-1'
const PUBLISHED = { id: COURSE_ID, status: 'published', isActive: true }

const makePayload = ({ existing = [] as unknown[], course = PUBLISHED as unknown } = {}) => ({
  find: vi.fn().mockResolvedValue({ docs: existing }),
  findByID: vi.fn().mockResolvedValue(course),
  create: vi.fn().mockResolvedValue({ id: 'signup-1' }),
  delete: vi.fn().mockResolvedValue({ docs: [], errors: [] }),
})

const cookieReq = (payload: ReturnType<typeof makePayload>, body: unknown) =>
  ({ headers: new Headers(), user: { id: USER_ID }, payload, json: async () => body }) as any

const serviceReq = (payload: ReturnType<typeof makePayload>, body: unknown) =>
  ({
    headers: new Headers({ 'x-service-token': SERVICE_TOKEN }),
    user: null,
    payload,
    json: async () => body,
  }) as any

describe('course sign-ups', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_SERVICE_TOKEN', SERVICE_TOKEN)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  describe('addCourseSignup', () => {
    it('creates a sign-up for the session user', async () => {
      const payload = makePayload()

      const res = await addCourseSignup(cookieReq(payload, { courseId: COURSE_ID }))

      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual({ courseId: COURSE_ID, signedUp: true })
      expect(payload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'course-signups',
          data: { user: USER_ID, course: COURSE_ID },
        }),
      )
    })

    it('never writes an enrollment or touches the user', async () => {
      const payload = makePayload()

      await addCourseSignup(cookieReq(payload, { courseId: COURSE_ID }))

      expect(payload.create).toHaveBeenCalledTimes(1)
      expect(payload.create.mock.calls[0][0].collection).toBe('course-signups')
    })

    it('targets body userId with a service token', async () => {
      const payload = makePayload()

      await addCourseSignup(serviceReq(payload, { courseId: COURSE_ID, userId: 'user-2' }))

      expect(payload.create.mock.calls[0][0].data.user).toBe('user-2')
    })

    it('is a no-op when already signed up', async () => {
      const payload = makePayload({ existing: [{ id: 'signup-1' }] })

      const res = await addCourseSignup(cookieReq(payload, { courseId: COURSE_ID }))

      expect(res.status).toBe(200)
      expect(payload.create).not.toHaveBeenCalled()
    })

    it.each([
      ['missing', null],
      ['draft', { ...PUBLISHED, status: 'draft' }],
      ['inactive', { ...PUBLISHED, isActive: false }],
    ])('rejects a %s course', async (_label, course) => {
      const payload = makePayload({ course })

      const res = await addCourseSignup(cookieReq(payload, { courseId: COURSE_ID }))

      expect(res.status).toBe(400)
      expect(payload.create).not.toHaveBeenCalled()
    })

    it('treats losing a concurrent create as success', async () => {
      const payload = makePayload()
      payload.find
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [{ id: 'signup-1' }] })
      payload.create.mockRejectedValueOnce(new Error('E11000 duplicate key'))

      const res = await addCourseSignup(cookieReq(payload, { courseId: COURSE_ID }))

      expect(res.status).toBe(200)
    })

    it('rethrows a create failure when no sign-up exists', async () => {
      const payload = makePayload()
      payload.create.mockRejectedValueOnce(new Error('db down'))

      await expect(addCourseSignup(cookieReq(payload, { courseId: COURSE_ID }))).rejects.toThrow(
        'db down',
      )
    })

    it('rejects an invalid body', async () => {
      const res = await addCourseSignup(cookieReq(makePayload(), {}))

      expect(res.status).toBe(400)
    })

    it('rejects unauthenticated requests', async () => {
      const req = { ...cookieReq(makePayload(), { courseId: COURSE_ID }), user: null }

      const res = await addCourseSignup(req)

      expect(res.status).toBe(401)
    })

    it('rejects userId on a cookie session', async () => {
      const payload = makePayload()

      const res = await addCourseSignup(
        cookieReq(payload, { courseId: COURSE_ID, userId: 'user-2' }),
      )

      expect(res.status).toBe(400)
      expect(payload.create).not.toHaveBeenCalled()
    })
  })

  describe('removeCourseSignup', () => {
    it('deletes only the matching user+course row', async () => {
      const payload = makePayload()

      const res = await removeCourseSignup(cookieReq(payload, { courseId: COURSE_ID }))

      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual({ courseId: COURSE_ID, signedUp: false })
      expect(payload.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'course-signups',
          where: { and: [{ user: { equals: USER_ID } }, { course: { equals: COURSE_ID } }] },
        }),
      )
    })

    it('rejects unauthenticated requests', async () => {
      const payload = makePayload()
      const req = { ...cookieReq(payload, { courseId: COURSE_ID }), user: null }

      const res = await removeCourseSignup(req)

      expect(res.status).toBe(401)
      expect(payload.delete).not.toHaveBeenCalled()
    })
  })
})
