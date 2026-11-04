/**
 * Unit tests for `updateCourseState` — PATCH /api/users/me/course-state.
 *
 * Covers the three `currentCourse` body shapes (string / null / omitted)
 * across both auth paths (cookie session and service token).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { updateCourseState } from '@/server/payload/endpoints/users-me-course-state/update-course-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SERVICE_TOKEN = 'test-service-token'
const USER_ID = 'user-1'
const COURSE_ID = 'course-1'

type AuthMode = 'cookie' | 'service'

const makePayload = (stored: Record<string, unknown> = {}) => ({
  findByID: vi.fn().mockResolvedValue({ id: COURSE_ID }),
  update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: USER_ID,
    ...stored,
    ...data,
  })),
})

const makeReq = (mode: AuthMode, body: Record<string, unknown>, payload = makePayload()) => {
  const headers = new Headers()
  if (mode === 'service') headers.set('x-service-token', SERVICE_TOKEN)
  const fullBody = mode === 'service' ? { userId: USER_ID, ...body } : body
  const req = {
    headers,
    user: mode === 'cookie' ? { id: USER_ID } : null,
    payload,
    json: async () => fullBody,
  } as any
  return { req, payload }
}

describe('updateCourseState', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_SERVICE_TOKEN', SERVICE_TOKEN)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  describe.each<AuthMode>(['cookie', 'service'])('%s auth', (mode) => {
    it('verifies and writes a string currentCourse', async () => {
      const { req, payload } = makeReq(mode, { currentCourse: COURSE_ID })

      const res = await updateCourseState(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(payload.findByID).toHaveBeenCalledWith(
        expect.objectContaining({ collection: 'courses', id: COURSE_ID }),
      )
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          id: USER_ID,
          data: expect.objectContaining({ currentCourse: COURSE_ID }),
        }),
      )
      expect(json.data.currentCourse).toBe(COURSE_ID)
    })

    it('clears currentCourse when null without looking up a course', async () => {
      const { req, payload } = makeReq(
        mode,
        { currentCourse: null },
        makePayload({ currentCourse: COURSE_ID }),
      )

      const res = await updateCourseState(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(payload.findByID).not.toHaveBeenCalled()
      const { data } = payload.update.mock.calls[0][0]
      expect(data).toHaveProperty('currentCourse', null)
      expect(typeof data.lastLoginAt).toBe('string')
      expect(json).toEqual({
        success: true,
        data: { currentCourse: null, lastLoginAt: data.lastLoginAt },
      })
    })

    it('treats an omitted currentCourse as a heartbeat only', async () => {
      const { req, payload } = makeReq(mode, {}, makePayload({ currentCourse: COURSE_ID }))

      const res = await updateCourseState(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(payload.findByID).not.toHaveBeenCalled()
      const { data } = payload.update.mock.calls[0][0]
      expect(data).not.toHaveProperty('currentCourse')
      expect(typeof data.lastLoginAt).toBe('string')
      expect(json.data.currentCourse).toBe(COURSE_ID)
    })
  })

  it('still rejects an empty-string currentCourse', async () => {
    const { req, payload } = makeReq('cookie', { currentCourse: '' })

    const res = await updateCourseState(req)

    expect(res.status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('returns 400 when a string currentCourse does not exist', async () => {
    const payload = makePayload()
    payload.findByID.mockResolvedValue(null)
    const { req } = makeReq('service', { currentCourse: 'missing' }, payload)

    const res = await updateCourseState(req)

    expect(res.status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
})
