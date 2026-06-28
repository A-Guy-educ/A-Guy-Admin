import { describe, expect, it } from 'vitest'

import { __test } from '@/server/services/content-promotion/export-content'

const { collectMediaIdsFromDoc } = __test

function collect(
  collection: 'courses' | 'chapters' | 'lessons' | 'exercises',
  doc: Record<string, unknown>,
): string[] {
  const out = new Set<string>()
  collectMediaIdsFromDoc(doc, collection, out)
  return Array.from(out)
}

describe('collectMediaIdsFromDoc', () => {
  it('pulls course.mediaFiles', () => {
    expect(collect('courses', { mediaFiles: ['m1', 'm2'] }).sort()).toEqual(['m1', 'm2'])
  })

  it('pulls chapter.mediaFiles', () => {
    expect(collect('chapters', { mediaFiles: ['m1'] })).toEqual(['m1'])
  })

  it('pulls lesson.contentFiles', () => {
    expect(collect('lessons', { contentFiles: ['m1', 'm2'] }).sort()).toEqual(['m1', 'm2'])
  })

  it('pulls exercise.sourceDoc plus mediaIds nested inside content.blocks', () => {
    const doc = {
      sourceDoc: 'pdf1',
      content: {
        blocks: [
          { type: 'rich_text', mediaIds: ['m1', 'm2'] },
          { type: 'rich_text', mediaIds: ['m3'] },
        ],
      },
    }
    expect(collect('exercises', doc).sort()).toEqual(['m1', 'm2', 'm3', 'pdf1'])
  })

  it('pulls media ids out of MCQ option contents', () => {
    const doc = {
      content: {
        blocks: [
          {
            type: 'question_select',
            options: [
              { content: { mediaIds: ['opt-m1'] } },
              { content: { mediaIds: ['opt-m2', 'opt-m3'] } },
            ],
          },
        ],
      },
    }
    expect(collect('exercises', doc).sort()).toEqual(['opt-m1', 'opt-m2', 'opt-m3'])
  })

  it('returns nothing for docs whose media-bearing fields are absent', () => {
    expect(collect('courses', { title: 'Foo' })).toEqual([])
    expect(collect('exercises', { title: 'Bar' })).toEqual([])
  })

  it('de-dupes inside the destination Set (same id referenced twice)', () => {
    const out = new Set<string>()
    collectMediaIdsFromDoc({ mediaFiles: ['m1', 'm1'] }, 'courses', out)
    collectMediaIdsFromDoc({ contentFiles: ['m1', 'm2'] }, 'lessons', out)
    expect(Array.from(out).sort()).toEqual(['m1', 'm2'])
  })

  it('ignores non-string values in upload arrays', () => {
    expect(collect('courses', { mediaFiles: ['m1', null, 42, ''] })).toEqual(['m1'])
  })
})
