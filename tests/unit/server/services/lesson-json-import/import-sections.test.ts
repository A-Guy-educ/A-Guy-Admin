import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  convertExerciseToSections,
  type ConvertedExercise,
} from '@/server/services/lesson-json-import/convert-exercise'
import { importLessonFromJson } from '@/server/services/lesson-json-import/import-lesson'
import type {
  LessonJsonExercise,
  LessonJsonSection,
} from '@/server/services/lesson-json-import/json-schema'

const getDefaultTenantIdMock = vi.hoisted(() => vi.fn())

vi.mock('@/server/repos/tenant/get-default-tenant', () => ({
  getDefaultTenantId: getDefaultTenantIdMock,
}))

function makeSection(overrides: Partial<LessonJsonSection> = {}): LessonJsonSection {
  return {
    section_data: { text: 'Section context', svg: '<svg>section</svg>' },
    question_number: 'א',
    question: { text: 'Question?', svg: '<svg>question</svg>' },
    correct_option: { text: 'Correct' },
    wrong_options: [{ text: 'Wrong' }],
    ...overrides,
  }
}

function makeExercise(overrides: Partial<LessonJsonExercise> = {}): LessonJsonExercise {
  return {
    exercise_number: '1',
    topic: 'Topic',
    exercise_content: {
      data: { text: 'Shared text', svg: '<svg>shared</svg>' },
      sections: [makeSection()],
    },
    ...overrides,
  }
}

describe('convertExerciseToSections', () => {
  it('keeps shared setup separate and preserves each section block order', () => {
    const converted: ConvertedExercise = convertExerciseToSections(makeExercise())

    expect(converted.sharedBlocks.map((block) => block.type)).toEqual(['svg', 'rich_text'])
    expect(converted.sections).toHaveLength(1)
    expect(converted.sections[0].title).toBe('סעיף א')
    expect(converted.sections[0].blocks.map((block) => block.type)).toEqual([
      'svg',
      'rich_text',
      'svg',
      'question_select',
    ])
  })

  it('falls back to truncated question text and then source order for section titles', () => {
    const longQuestion = 'שאלה ארוכה '.repeat(10)
    const exercise = makeExercise({
      exercise_content: {
        sections: [
          makeSection({ question_number: ' ', question: { text: longQuestion } }),
          makeSection({ question_number: '', question: { text: ' ' } }),
        ],
      },
    })

    const converted = convertExerciseToSections(exercise)

    expect(converted.sharedBlocks).toEqual([])
    expect(converted.sections[0].title).toBe(longQuestion.trim().slice(0, 60))
    expect(converted.sections[1].title).toBe('סעיף 2')
  })
})

describe('importLessonFromJson', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDefaultTenantIdMock.mockResolvedValue('tenant-1')
  })

  it('creates sections sequentially and writes their ordered exercise playlist', async () => {
    const createMock = vi.fn()
    const updateMock = vi.fn().mockResolvedValue({})
    const deleteMock = vi.fn().mockResolvedValue({})
    let sectionIndex = 0

    createMock.mockImplementation(async ({ collection }: { collection: string }) => {
      if (collection === 'lessons') return { id: 'lesson-1', title: 'Topic' }
      if (collection === 'exercises') return { id: 'exercise-1' }
      if (collection === 'sections') {
        sectionIndex += 1
        return { id: `section-${sectionIndex}` }
      }
      throw new Error(`Unexpected collection: ${collection}`)
    })

    const req = {
      user: { id: 'user-1' },
      payload: {
        findByID: vi.fn().mockResolvedValue({ id: 'chapter-1' }),
        find: vi.fn().mockResolvedValue({ docs: [] }),
        create: createMock,
        update: updateMock,
        delete: deleteMock,
      },
    } as unknown as PayloadRequest

    const exercise = makeExercise({
      exercise_content: {
        sections: [makeSection(), makeSection({ question_number: 'ב' })],
      },
    })
    const result = await importLessonFromJson(req, {
      chapterId: 'chapter-1',
      filename: 'שיעור 1.json',
      json: { topic: 'Topic', exercises: [exercise] },
    })

    expect(result).toMatchObject({ success: true, exercisesCreated: 1, exercisesFailed: 0 })
    expect(createMock.mock.calls.map(([call]) => call.collection)).toEqual([
      'lessons',
      'exercises',
      'sections',
      'sections',
    ])

    const exerciseCreate = createMock.mock.calls.find(
      ([call]) => call.collection === 'exercises',
    )?.[0]
    expect(exerciseCreate).toEqual(
      expect.objectContaining({
        context: { _skipBlockSync: true },
        data: expect.objectContaining({
          content: {
            blocks: [
              expect.objectContaining({
                type: 'rich_text',
                format: 'md-math-v1',
                value: '',
                mediaIds: [],
              }),
            ],
          },
        }),
      }),
    )

    const sectionCreates = createMock.mock.calls
      .map(([call]) => call)
      .filter((call) => call.collection === 'sections')
    expect(sectionCreates).toEqual([
      expect.objectContaining({
        context: { _skipExerciseBlockSync: true },
        data: expect.objectContaining({
          tenant: 'tenant-1',
          title: 'סעיף א',
          exercise: 'exercise-1',
          order: 0,
          exerciseType: 'basic',
        }),
      }),
      expect.objectContaining({
        context: { _skipExerciseBlockSync: true },
        data: expect.objectContaining({
          tenant: 'tenant-1',
          title: 'סעיף ב',
          exercise: 'exercise-1',
          order: 1,
          exerciseType: 'basic',
        }),
      }),
    ])

    const exerciseUpdate = updateMock.mock.calls.find(
      ([call]) => call.collection === 'exercises',
    )?.[0]
    expect(exerciseUpdate).toEqual(
      expect.objectContaining({
        id: 'exercise-1',
        context: { _skipExerciseBlockSync: true },
      }),
    )
    expect(JSON.parse(exerciseUpdate.data.blocks)).toEqual([
      expect.objectContaining({ blockType: 'sectionRef', section: 'section-1' }),
      expect.objectContaining({ blockType: 'sectionRef', section: 'section-2' }),
    ])
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('rolls back sections before exercises and the lesson when section creation fails', async () => {
    const createMock = vi.fn()
    const updateMock = vi.fn().mockResolvedValue({})
    const deleteMock = vi.fn().mockResolvedValue({})
    let sectionIndex = 0

    createMock.mockImplementation(async ({ collection }: { collection: string }) => {
      if (collection === 'lessons') return { id: 'lesson-1', title: 'Topic' }
      if (collection === 'exercises') return { id: 'exercise-1' }
      if (collection === 'sections') {
        sectionIndex += 1
        if (sectionIndex === 2) throw new Error('Section create failed')
        return { id: 'section-1' }
      }
      throw new Error(`Unexpected collection: ${collection}`)
    })

    const req = {
      user: { id: 'user-1' },
      payload: {
        findByID: vi.fn().mockResolvedValue({ id: 'chapter-1' }),
        find: vi.fn().mockResolvedValue({ docs: [] }),
        create: createMock,
        update: updateMock,
        delete: deleteMock,
      },
    } as unknown as PayloadRequest

    const exercise = makeExercise({
      exercise_content: {
        sections: [makeSection(), makeSection({ question_number: 'ב' })],
      },
    })
    const result = await importLessonFromJson(req, {
      chapterId: 'chapter-1',
      filename: 'שיעור 1.json',
      json: { topic: 'Topic', exercises: [exercise] },
    })

    expect(result).toMatchObject({ success: false, exercisesCreated: 0, exercisesFailed: 1 })
    expect(deleteMock.mock.calls.map(([call]) => `${call.collection}:${call.id}`)).toEqual([
      'sections:section-1',
      'exercises:exercise-1',
      'lessons:lesson-1',
    ])
    expect(updateMock).not.toHaveBeenCalled()
  })
})
