/**
 * B2B/B2C segment: a user is B2B iff they appear in any class's students[]
 * or teachers[]. Derived on read, never stored.
 */
import { describe, expect, it, vi } from 'vitest'

import { attachUserSegment } from '@/server/payload/collections/Users/hooks/attachUserSegment-hook'
import { userSegmentListFilter } from '@/server/payload/collections/Users/userSegmentListFilter'

type HookArgs = Parameters<typeof attachUserSegment>[0]
type FilterArgs = Parameters<typeof userSegmentListFilter>[0]

interface ClassRow {
  school: string
  students: string[]
  teachers: string[]
}

const SCHOOLS = [
  { id: 'school-a', name: 'Herzl High' },
  { id: 'school-b', name: 'Rabin Middle' },
]

const CLASSES: ClassRow[] = [
  { school: 'school-a', students: ['student-1'], teachers: ['teacher-1'] },
  { school: 'school-a', students: ['mixed-1'], teachers: [] },
  { school: 'school-b', students: ['student-2'], teachers: ['mixed-1'] },
  { school: 'school-b', students: ['mixed-1'], teachers: [] },
]

const inList = (where: unknown, path: string): string[] | undefined =>
  (where as Record<string, { in?: string[] }> | undefined)?.[path]?.in

const createReq = (role = 'admin') => {
  const find = vi.fn(
    async ({ collection, where }: { collection: string; where?: Record<string, unknown> }) => {
      if (collection === 'schools') {
        const ids = inList(where, 'id') ?? []
        return { docs: SCHOOLS.filter((s) => ids.includes(s.id)) }
      }
      const or = where?.or as unknown[] | undefined
      if (!or) return { docs: CLASSES }
      const ids = [...(inList(or[0], 'students') ?? []), ...(inList(or[1], 'teachers') ?? [])]
      return {
        docs: CLASSES.filter((c) => [...c.students, ...c.teachers].some((id) => ids.includes(id))),
      }
    },
  )
  const req = {
    context: {},
    query: {},
    user: { id: 'reader', collection: 'users', role },
    payload: { find, logger: { warn: vi.fn() } },
  }
  return { req, find }
}

const runHook = (req: unknown, id: string) =>
  attachUserSegment({ doc: { id }, req } as unknown as HookArgs) as Promise<Record<string, unknown>>

const classQueries = (find: ReturnType<typeof vi.fn>) =>
  find.mock.calls.filter(([args]) => args.collection === 'classes').length

describe('attachUserSegment', () => {
  it('marks a user in no class as B2C with no schools', async () => {
    const { req } = createReq()
    const doc = await runHook(req, 'loner')
    expect(doc).toMatchObject({ segment: 'b2c', schools: [] })
  })

  it('marks a student in one class as B2B with that school', async () => {
    const { req } = createReq()
    const doc = await runHook(req, 'student-1')
    expect(doc).toMatchObject({ segment: 'b2b', schools: ['Herzl High'] })
  })

  it('lists each school once for a teacher in one school and student in another', async () => {
    const { req } = createReq()
    const doc = await runHook(req, 'mixed-1')
    expect(doc.segment).toBe('b2b')
    expect([...(doc.schools as string[])].sort()).toEqual(['Herzl High', 'Rabin Middle'])
  })

  it('resolves a whole list page with one classes query', async () => {
    const { req, find } = createReq()
    const docs = await Promise.all(
      ['student-1', 'student-2', 'teacher-1', 'loner'].map((id) => runHook(req, id)),
    )
    expect(docs.map((d) => d.segment)).toEqual(['b2b', 'b2b', 'b2b', 'b2c'])
    expect(classQueries(find)).toBe(1)
  })

  it('skips the lookup for non-admin readers', async () => {
    const { req, find } = createReq('student')
    const doc = await runHook(req, 'student-1')
    expect(doc).toEqual({ id: 'student-1' })
    expect(find).not.toHaveBeenCalled()
  })

  it('returns the doc unchanged when the lookup fails', async () => {
    const { req, find } = createReq()
    find.mockRejectedValueOnce(new Error('mongo down'))
    const doc = await runHook(req, 'student-1')
    expect(doc).toEqual({ id: 'student-1' })
  })
})

describe('userSegmentListFilter', () => {
  const runFilter = (req: unknown) => userSegmentListFilter({ req } as unknown as FilterArgs)

  it('returns null without a segment param', async () => {
    const { req } = createReq()
    expect(await runFilter(req)).toBeNull()
  })

  it('filters B2B to class members and B2C to everyone else', async () => {
    const members = ['student-1', 'teacher-1', 'mixed-1', 'student-2']

    const b2b = createReq()
    b2b.req.query = { segment: 'b2b' }
    const b2bWhere = (await runFilter(b2b.req)) as { id: { in: string[] } }
    expect([...b2bWhere.id.in].sort()).toEqual([...members].sort())

    const b2c = createReq()
    b2c.req.query = { segment: 'b2c' }
    const b2cWhere = (await runFilter(b2c.req)) as { id: { not_in: string[] } }
    expect([...b2cWhere.id.not_in].sort()).toEqual([...members].sort())
  })

  it('ignores the param for non-admin readers', async () => {
    const { req } = createReq('advanced-content-editor')
    req.query = { segment: 'b2b' }
    expect(await runFilter(req)).toBeNull()
  })
})
