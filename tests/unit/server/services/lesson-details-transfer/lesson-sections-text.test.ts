import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildCanonicalLessonExport } from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToText } from '@/server/services/lesson-export/to-text-format'
import { compactBlock, expandBlock } from '@/server/services/lesson-full-json/compact-blocks'
import {
  lessonDetailsFromLabels,
  meaningfulLessonBlocks,
  pickLessonDetails,
} from '@/server/services/lesson-details-transfer/lesson-details-fields'
import { parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'
import { importTextLessonFromFile } from '@/server/services/text-lesson-import/import-text-lesson'

const { getDefaultTenantIdMock } = vi.hoisted(() => ({ getDefaultTenantIdMock: vi.fn() }))
vi.mock('@/server/repos/tenant/get-default-tenant', () => ({
  getDefaultTenantId: getDefaultTenantIdMock,
}))

function inline(value: string) {
  return { type: 'rich_text' as const, format: 'md-math-v1' as const, value, mediaIds: [] }
}

const lessonBlocks = [
  { id: 'lb-1', ...inline('הקדמה לשיעור עם $x^2$') },
  { id: 'lb-2', type: 'html', html: '<p>[ תרגיל 9 - נתוני פתיחה ]</p>' },
  {
    id: 'lb-3',
    type: 'question_free_response',
    prompt: inline('AC=?'),
    answer: { acceptedAnswers: ['5'] },
  },
]

const lesson = {
  id: 'L1',
  title: 'פיתגורס',
  topic: 'גאומטריה',
  formulas: '$a^2+b^2=c^2$',
  // Multi-line, with a line that looks like an exercise header and a separator.
  commonMistakes: 'שוכחים לשרש\n[ תרגיל 1 - נתוני פתיחה ]\n----------\n\n* מחברים צלעות',
  publicExplanation: 'הסבר קצר',
  estimatedMinutes: 25,
  content: { blocks: lessonBlocks },
}

const exerciseDocs = [
  {
    id: 'E1',
    title: 'תרגיל 1',
    content: {
      blocks: [
        {
          id: 'q1',
          type: 'question_free_response',
          prompt: inline('כמה זה 2+2?'),
          answer: { acceptedAnswers: ['4'] },
        },
      ],
    },
  },
]

function exportText(doc: Record<string, unknown>) {
  const canonical = buildCanonicalLessonExport(doc, exerciseDocs, '')
  return serializeLessonToText(canonical, {
    details: pickLessonDetails(doc),
    blocks: meaningfulLessonBlocks(doc).map(compactBlock),
  })
}

const withoutId = ({ id: _id, ...rest }: Record<string, unknown>) => rest

describe('v2 text lesson sections (lesson fields + lesson blocks)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDefaultTenantIdMock.mockResolvedValue('tenant-1')
  })

  it('round-trips lesson fields exactly, including header-like lines', () => {
    const parsed = parseTextLessonV2(exportText(lesson))
    expect(lessonDetailsFromLabels(parsed.lessonSections.detailsByLabel)).toEqual(
      pickLessonDetails(lesson),
    )
  })

  it('round-trips lesson blocks losslessly', () => {
    const parsed = parseTextLessonV2(exportText(lesson))
    const blocks = (JSON.parse(parsed.lessonSections.blocksJson!) as unknown[]).map(expandBlock)
    expect(blocks).toEqual(lessonBlocks.map(withoutId))
  })

  it('still parses the exercises after the lesson sections', () => {
    const parsed = parseTextLessonV2(exportText(lesson))
    expect(parsed.exercises).toHaveLength(1)
    expect(parsed.exercises[0].sections[0].question).toContain('כמה זה 2+2?')
  })

  it('emits no lesson sections for a lesson without fields or blocks', () => {
    const text = exportText({ id: 'L2', title: 'ריק' })
    expect(text).not.toContain('פרטי השיעור')
    expect(text).not.toContain('בלוקים של השיעור')
    expect(parseTextLessonV2(text).lessonSections).toEqual({ detailsByLabel: {} })
  })

  it('imports lesson fields and blocks onto the new lesson', async () => {
    const create = vi.fn(async ({ collection }: { collection: string }) =>
      collection === 'lessons' ? { id: 'new', title: 'x' } : { id: `${collection}-id` },
    )
    const req = {
      user: { id: 'u1' },
      payload: {
        findByID: vi.fn().mockResolvedValue({ id: 'chapter-1' }),
        find: vi.fn().mockResolvedValue({ docs: [] }),
        create,
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PayloadRequest

    const result = await importTextLessonFromFile(req, {
      chapterId: 'chapter-1',
      filename: 'פיתגורס.txt',
      text: exportText(lesson),
    })

    expect(result).toMatchObject({ success: true })
    const lessonCall = create.mock.calls
      .map(([call]) => call as unknown as { collection: string; data: Record<string, unknown> })
      .find((call) => call.collection === 'lessons')!
    expect(lessonCall.data).toMatchObject(pickLessonDetails(lesson))
    const blocks = (lessonCall.data.content as { blocks: Array<Record<string, unknown>> }).blocks
    expect(blocks.map(withoutId)).toEqual(lessonBlocks.map(withoutId))
  })

  it('reports broken lesson-blocks JSON instead of importing', async () => {
    const text = exportText(lesson).replace('"AC=?"', '"AC=?",,')
    const req = { user: { id: 'u1' }, payload: { create: vi.fn() } } as unknown as PayloadRequest

    const result = await importTextLessonFromFile(req, { chapterId: 'c', filename: 'x', text })

    expect(result).toMatchObject({ kind: 'validation' })
    expect(req.payload.create).not.toHaveBeenCalled()
  })
})
