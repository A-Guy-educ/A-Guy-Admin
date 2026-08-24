/**
 * @fileType unit-test
 * @domain lessons
 * @pattern read-hook-fast-path
 * @ai-summary Verifies populateLessonAdminTitle skips its findByID lookup when
 *   the stored adminTitle is already populated (perf fast path). The legacy
 *   compute path is still exercised implicitly by chapter-admin-title-cascade
 *   integration tests.
 */
import { describe, expect, it, vi } from 'vitest'

import { populateLessonAdminTitle } from '@/server/payload/collections/Lessons'

const makeArgs = (doc: Record<string, unknown>, findByID = vi.fn()) =>
  ({
    doc,
    req: { payload: { findByID } },
    // Remaining CollectionAfterReadHook fields are unused by this hook.
  }) as unknown as Parameters<typeof populateLessonAdminTitle>[0]

describe('populateLessonAdminTitle — trust-stored fast path', () => {
  it('returns doc without calling findByID when stored adminTitle is present', async () => {
    const findByID = vi.fn()
    const doc = {
      title: 'Lesson 1',
      adminTitle: 'Course A / Chapter 1 / Lesson 1',
      chapter: 'chapter-id',
    }

    const result = await populateLessonAdminTitle(makeArgs(doc, findByID))

    expect(findByID).not.toHaveBeenCalled()
    expect((result as { adminTitle: string }).adminTitle).toBe('Course A / Chapter 1 / Lesson 1')
  })

  it('falls through to compute path when adminTitle is missing (legacy doc)', async () => {
    const findByID = vi.fn().mockResolvedValue({
      title: 'Chapter 1',
      chapterLabel: 'Ch',
      course: { title: 'Course A', courseLabel: 'CA' },
    })
    const doc = {
      title: 'Lesson 1',
      chapter: 'chapter-id',
      // no adminTitle stored — mimics a legacy doc before beforeChange ran
    }

    const result = await populateLessonAdminTitle(makeArgs(doc, findByID))

    expect(findByID).toHaveBeenCalledTimes(1)
    expect((result as { adminTitle: string }).adminTitle).toContain('Lesson 1')
  })

  it('returns doc untouched when title is missing entirely', async () => {
    const findByID = vi.fn()
    const doc = { chapter: 'chapter-id' } // no title

    const result = await populateLessonAdminTitle(makeArgs(doc, findByID))

    expect(findByID).not.toHaveBeenCalled()
    expect((result as { adminTitle?: string }).adminTitle).toBeUndefined()
  })
})
