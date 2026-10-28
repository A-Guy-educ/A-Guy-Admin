import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFullLessonExport } from '@/server/services/lesson-full-json/build-full-lesson-export'
import { isFullLessonJson } from '@/infra/contracts/lesson-full-json/v1'
import { importFullLessonJson } from '@/server/services/lesson-full-json/import-full-lesson'

const { getDefaultTenantIdMock } = vi.hoisted(() => ({ getDefaultTenantIdMock: vi.fn() }))
vi.mock('@/server/repos/tenant/get-default-tenant', () => ({
  getDefaultTenantId: getDefaultTenantIdMock,
}))

function inline(value: string) {
  return { type: 'rich_text' as const, format: 'md-math-v1' as const, value, mediaIds: [] }
}

// Blocks the v2 text format can't carry — they must survive untouched here.
const axisWithText = {
  id: 'axis-1',
  type: 'question_axis',
  prompt: inline('נתון משולש ABC'),
  layout: 'textLeft',
  displaySize: 'small',
  axis: {
    kind: 'cartesian',
    units: 1,
    proportion: 1.1,
    interactive: false,
    grid: { enabled: true },
    axes: {
      showNumbers: false,
      showLabels: true,
      ticks: 1,
      labels: { x: 'x', y: 'y' },
      origin: { x: 0, y: 0 },
    },
    viewportMode: 'manual',
    viewport: { xMin: -1, xMax: 7, yMin: -2, yMax: 6 },
    elements: {
      points: [{ x: 1, y: 1, type: 'point', label: 'A', size: 3, labelPosition: 'bl' }],
      graphs: [],
      asymptotesVertical: [2],
    },
  },
}
const trueFalse = {
  id: 'tf-1',
  type: 'question_select',
  variant: 'true_false',
  selectionMode: 'single',
  prompt: inline('2+2=4?'),
  options: [
    { id: 'true', value: true, label: inline('נכון') },
    { id: 'false', value: false, label: inline('לא נכון') },
  ],
  answer: { correctOptionId: 'true' },
  solution: inline('short'),
  fullSolution: inline('long'),
  showNotebook: true,
}
const freeResponse = {
  id: 'fr-1',
  type: 'question_free_response',
  prompt: inline('AC=?'),
  answer: { acceptedAnswers: ['5', 'חמש'] },
}
const html = { id: 'html-1', type: 'html', html: '<p><strong>שימו לב</strong></p>' }
const media = { id: 'media-1', type: 'media', mediaId: 'm-123' }

const lesson = { id: 'L1', title: 'פיתגורס', type: 'practice', slug: 'pythagoras' }
const exerciseDocs = [
  { id: 'E1', title: 'תרגיל 1', topic: 'משפט פיתגורס', content: { blocks: [axisWithText, html] } },
]
const sections = new Map([
  [
    'E1',
    [
      {
        id: 'S1',
        title: 'סעיף א',
        exerciseType: 'complex',
        mainSkill: 'understanding',
        content: { blocks: [trueFalse, freeResponse] },
      },
      { id: 'S2', title: 'סעיף ב', exerciseType: 'basic', content: { blocks: [media] } },
    ],
  ],
])

/** Strip ids so blocks can be compared regardless of the fresh ids on import. */
function withoutIds(blocks: Array<Record<string, unknown>>) {
  return blocks.map(({ id: _id, ...rest }) => rest)
}

function mockReq() {
  const createMock = vi.fn(async ({ collection }: { collection: string }) => {
    if (collection === 'lessons') return { id: 'new-lesson', title: 'פיתגורס' }
    return { id: `${collection}-${createMock.mock.calls.length}` }
  })
  const req = {
    user: { id: 'user-1' },
    payload: {
      findByID: vi.fn().mockResolvedValue({ id: 'chapter-1' }),
      find: vi.fn().mockResolvedValue({ docs: [] }),
      create: createMock,
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PayloadRequest
  return { req, createMock }
}

function createdData(createMock: ReturnType<typeof mockReq>['createMock'], collection: string) {
  return createMock.mock.calls
    .map(([call]) => call as unknown as { collection: string; data: Record<string, unknown> })
    .filter((call) => call.collection === collection)
    .map((call) => call.data)
}

describe('full lesson JSON export → import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDefaultTenantIdMock.mockResolvedValue('tenant-1')
  })

  it('exports a self-describing file without internal ids', () => {
    const file = buildFullLessonExport(lesson, exerciseDocs, sections)
    expect(isFullLessonJson(file)).toBe(true)
    expect(file.lesson).toEqual({ title: 'פיתגורס', type: 'practice' })
    expect(file.exercises[0]).not.toHaveProperty('id')
    expect(file.exercises[0].sections[0]).toMatchObject({
      title: 'סעיף א',
      exerciseType: 'complex',
      mainSkill: 'understanding',
    })
  })

  it('recreates every block exactly (survives a JSON stringify round-trip)', async () => {
    const file = JSON.parse(JSON.stringify(buildFullLessonExport(lesson, exerciseDocs, sections)))
    const { req, createMock } = mockReq()

    const result = await importFullLessonJson(req, { chapterId: 'chapter-1', json: file })

    expect(result).toMatchObject({ success: true, exercisesCreated: 1 })
    const [lessonData] = createdData(createMock, 'lessons')
    expect(lessonData).toMatchObject({ title: 'פיתגורס', type: 'practice' })

    const [exercise] = createdData(createMock, 'exercises')
    expect(exercise).toMatchObject({ title: 'תרגיל 1', topic: 'משפט פיתגורס' })
    const exBlocks = (exercise.content as { blocks: Array<Record<string, unknown>> }).blocks
    expect(withoutIds(exBlocks)).toEqual(withoutIds([axisWithText, html]))

    const [s1, s2] = createdData(createMock, 'sections')
    expect(s1).toMatchObject({
      title: 'סעיף א',
      exerciseType: 'complex',
      mainSkill: 'understanding',
    })
    const s1Blocks = (s1.content as { blocks: Array<Record<string, unknown>> }).blocks
    expect(withoutIds(s1Blocks)).toEqual(withoutIds([trueFalse, freeResponse]))
    expect((s2.content as { blocks: unknown[] }).blocks).toEqual([
      expect.objectContaining({ type: 'media', mediaId: 'm-123' }),
    ])
  })

  it('gives blocks fresh ids and accepts blocks the LLM added without an id', async () => {
    const file = JSON.parse(JSON.stringify(buildFullLessonExport(lesson, exerciseDocs, sections)))
    file.exercises[0].sections[1].blocks.push({
      type: 'rich_text',
      format: 'md-math-v1',
      value: 'חדש',
    })
    const { req, createMock } = mockReq()

    const result = await importFullLessonJson(req, { chapterId: 'chapter-1', json: file })

    expect(result).toMatchObject({ success: true })
    const blocks = createdData(createMock, 'sections')[1].content as {
      blocks: Array<{ id: string }>
    }
    expect(blocks.blocks).toHaveLength(2)
    expect(blocks.blocks.every((b) => typeof b.id === 'string' && b.id !== 'media-1')).toBe(true)
  })

  it('rejects a broken block with a readable location and writes nothing', async () => {
    const file = JSON.parse(JSON.stringify(buildFullLessonExport(lesson, exerciseDocs, sections)))
    file.exercises[0].sections[0].blocks[1].answer.acceptedAnswers = []
    const { req, createMock } = mockReq()

    const result = await importFullLessonJson(req, { chapterId: 'chapter-1', json: file })

    expect(result).toMatchObject({ kind: 'validation' })
    const issues = (result as { issues: Array<{ path: string }> }).issues
    expect(issues[0].path).toContain(
      'exercise 1 › section 1 › block 2 (question_free_response) › answer › acceptedAnswers',
    )
    expect(createMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong wrapper (missing lesson title)', async () => {
    const file = JSON.parse(JSON.stringify(buildFullLessonExport(lesson, exerciseDocs, sections)))
    delete file.lesson.title
    const { req, createMock } = mockReq()

    const result = await importFullLessonJson(req, { chapterId: 'chapter-1', json: file })

    expect(result).toMatchObject({ kind: 'validation' })
    expect(createMock).not.toHaveBeenCalled()
  })
})
