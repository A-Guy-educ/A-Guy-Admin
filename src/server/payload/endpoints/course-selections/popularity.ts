/**
 * GET /api/course-selections/popularity
 *
 * Returns per-course popularity stats aggregated from the
 * `course_selections` collection.
 *
 * @fileType endpoint-handler
 * @domain analytics
 * @pattern aggregation-report
 * @ai-summary Runs a single MongoDB aggregation pipeline against
 *   `course_selections` grouped by `course`, then batches a single Payload
 *   `find` to resolve course titles. Returns one row per course that has
 *   at least one selection matching the filters.
 *
 * Query parameters:
 *   - gradeLevel  optional  exact-match filter on gradeLevel
 *   - source      optional  one of start-page | homepage-greeting | course-card | other
 *
 * Response 200:
 *   {
 *     rows: Array<{
 *       courseId: string,
 *       courseTitle: string,
 *       totalPicks: number,
 *       uniqueGuests: number,
 *       uniqueUsers: number,
 *       last7d: number,
 *       last30d: number,
 *     }>,
 *     filters: { gradeLevel?: string, source?: string }
 *   }
 *
 * Errors:
 *   401 — not authenticated
 *   403 — authenticated but not admin
 *   400 — invalid `source`
 *   500 — unexpected
 */
import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { COURSE_SELECTION_SOURCES } from '@/server/payload/collections/CourseSelections'

const querySchema = z.object({
  gradeLevel: z.string().min(1).max(64).optional(),
  source: z.enum(COURSE_SELECTION_SOURCES).optional(),
})

export type PopularitySortKey =
  | 'courseTitle'
  | 'totalPicks'
  | 'uniqueGuests'
  | 'uniqueUsers'
  | 'last7d'
  | 'last30d'

export interface PopularityRow {
  courseId: string
  courseTitle: string
  totalPicks: number
  uniqueGuests: number
  uniqueUsers: number
  last7d: number
  last30d: number
}

export interface PopularityResponse {
  rows: PopularityRow[]
  filters: { gradeLevel?: string; source?: string }
}

export async function getCourseSelectionPopularity(req: PayloadRequest): Promise<Response> {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!('collection' in req.user) || req.user.collection !== 'users' || req.user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const parsed = querySchema.safeParse({
    gradeLevel: url.searchParams.get('gradeLevel') || undefined,
    source: (url.searchParams.get('source') || undefined) as
      | (typeof COURSE_SELECTION_SOURCES)[number]
      | undefined,
  })
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid query', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const filters: Record<string, unknown> = {}
  if (parsed.data.gradeLevel) filters.gradeLevel = parsed.data.gradeLevel
  if (parsed.data.source) filters.source = parsed.data.source

  const db = req.payload.db.connection?.db
  if (!db) {
    return Response.json({ error: 'Database connection unavailable' }, { status: 500 })
  }

  const collection = db.collection<{ course?: unknown }>('course_selections')

  try {
    const matchStage = Object.keys(filters).length > 0 ? [{ $match: filters }] : []

    const groups = await collection
      .aggregate([
        ...matchStage,
        {
          $group: {
            _id: '$course',
            totalPicks: { $sum: 1 },
            uniqueGuests: { $addToSet: '$guestId' },
            uniqueUsers: { $addToSet: '$user' },
            last7d: {
              $sum: {
                $cond: [
                  {
                    $gte: ['$createdAt', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)],
                  },
                  1,
                  0,
                ],
              },
            },
            last30d: {
              $sum: {
                $cond: [
                  {
                    $gte: ['$createdAt', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 1,
            totalPicks: 1,
            last7d: 1,
            last30d: 1,
            uniqueGuests: {
              $size: {
                $setDifference: [
                  {
                    $filter: {
                      input: '$uniqueGuests',
                      as: 'g',
                      cond: {
                        $and: [{ $ne: ['$$g', null] }, { $ne: ['$$g', ''] }],
                      },
                    },
                  },
                  [],
                ],
              },
            },
            uniqueUsers: {
              $size: {
                $setDifference: [
                  {
                    $filter: {
                      input: '$uniqueUsers',
                      as: 'u',
                      cond: {
                        $and: [{ $ne: ['$$u', null] }, { $ne: ['$$u', ''] }],
                      },
                    },
                  },
                  [],
                ],
              },
            },
          },
        },
      ])
      .toArray()

    const courseIds = groups
      .map((g) => normalizeCourseId((g as { _id?: unknown })._id))
      .filter((id): id is string => Boolean(id))

    const titleMap = new Map<string, string>()
    if (courseIds.length > 0) {
      const courses = await req.payload.find({
        collection: 'courses',
        where: { id: { in: courseIds } },
        limit: courseIds.length,
        depth: 0,
        overrideAccess: true,
      })
      for (const doc of courses.docs) {
        const c = doc as unknown as {
          id?: string | number
          title?: string
          courseLabel?: string
          slug?: string
        }
        if (c.id !== undefined) {
          titleMap.set(
            String(c.id),
            c.title || c.courseLabel || c.slug || `Course ${String(c.id).slice(-6)}`,
          )
        }
      }
    }

    const rows: PopularityRow[] = groups
      .map((g) => {
        const courseId = normalizeCourseId((g as { _id?: unknown })._id)
        if (!courseId) return null
        return {
          courseId,
          courseTitle: titleMap.get(courseId) || `__DELETED__:${courseId.slice(-6)}`,
          totalPicks: numberOrZero((g as { totalPicks?: number }).totalPicks),
          uniqueGuests: numberOrZero((g as { uniqueGuests?: number }).uniqueGuests),
          uniqueUsers: numberOrZero((g as { uniqueUsers?: number }).uniqueUsers),
          last7d: numberOrZero((g as { last7d?: number }).last7d),
          last30d: numberOrZero((g as { last30d?: number }).last30d),
        }
      })
      .filter((r): r is PopularityRow => r !== null)

    const response: PopularityResponse = {
      rows,
      filters: {
        ...(parsed.data.gradeLevel ? { gradeLevel: parsed.data.gradeLevel } : {}),
        ...(parsed.data.source ? { source: parsed.data.source } : {}),
      },
    }

    return Response.json(response)
  } catch (err) {
    req.payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[course-selections/popularity] aggregation failed',
    )
    return Response.json({ error: 'Aggregation failed' }, { status: 500 })
  }
}

function numberOrZero(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function normalizeCourseId(course: unknown): string | null {
  if (course === undefined || course === null) return null
  if (typeof course === 'string') return course
  if (typeof course === 'object') {
    if ('id' in course) {
      const id = (course as { id?: unknown }).id
      if (typeof id === 'string') return id
      if (typeof id === 'number') return String(id)
    }
    if (typeof (course as { toString?: () => string }).toString === 'function') {
      const s = String(course)
      const match = s.match(/ObjectId\(['"]?([^'")]+)['"]?\)/)
      if (match) return match[1]
      if (s && s !== '[object Object]') return s
    }
  }
  return null
}
