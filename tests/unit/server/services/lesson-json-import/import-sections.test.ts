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

  describe('append-mode (targetLessonId)', () => {
    it('re-reads lesson.blocks at write-time and appends new exerciseRefs after existing ones', async () => {
      const existingBlocks = [
        { id: 'preexisting-1', blockType: 'exerciseRef', exercise: 'ex-existing' },
      ]

      let findByIDCalls = 0
      const findByID = vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === 'lessons') {
          findByIDCalls += 1
          if (findByIDCalls === 1) {
            return { id: 'lesson-1', title: 'Existing', blocks: JSON.stringify(existingBlocks) }
          }
          return {
            id: 'lesson-1',
            title: 'Existing',
            blocks: JSON.stringify([
              ...existingBlocks,
              { id: 'race-add', blockType: 'exerciseRef', exercise: 'ex-raced-in' },
            ]),
          }
        }
        return null
      })

      const createMock = vi.fn(async ({ collection }: { collection: string }) => {
        if (collection === 'exercises') return { id: 'new-ex-1' }
        if (collection === 'sections') return { id: 'new-sec-1' }
        throw new Error(`Unexpected collection: ${collection}`)
      })
      const updateMock = vi.fn().mockResolvedValue({})

      const req = {
        user: { id: 'user-1' },
        payload: {
          findByID,
          find: vi.fn().mockResolvedValue({ docs: [{ order: 5 }] }),
          create: createMock,
          update: updateMock,
          delete: vi.fn(),
        },
      } as unknown as PayloadRequest

      const result = await importLessonFromJson(req, {
        targetLessonId: 'lesson-1',
        filename: 'lesson.json',
        json: { topic: 'Topic', exercises: [makeExercise()] },
      })

      expect(result).toMatchObject({ success: true, exercisesCreated: 1, lessonId: 'lesson-1' })

      // We must NOT have created a new lesson.
      const lessonCreates = createMock.mock.calls.filter(([c]) => c.collection === 'lessons')
      expect(lessonCreates).toHaveLength(0)

      // New exercise's order must start after the current max (5 → 6).
      const exerciseCreate = createMock.mock.calls.find(
        ([c]) => c.collection === 'exercises',
      )?.[0] as { data: { order: number } } | undefined
      expect(exerciseCreate?.data.order).toBe(6)

      // Final lesson.blocks write MUST preserve the raced-in block.
      const lessonUpdate = updateMock.mock.calls.find(([c]) => c.collection === 'lessons')?.[0] as
        | { data: { blocks: string } }
        | undefined
      const written = JSON.parse(lessonUpdate!.data.blocks)
      expect(written).toEqual([
        expect.objectContaining({ id: 'preexisting-1', exercise: 'ex-existing' }),
        expect.objectContaining({ id: 'race-add', exercise: 'ex-raced-in' }),
        expect.objectContaining({ blockType: 'exerciseRef', exercise: 'new-ex-1' }),
      ])
    })

    it('append rollback deletes only new exercises + sections, NEVER the pre-existing lesson', async () => {
      const createMock = vi.fn()
      const deleteMock = vi.fn().mockResolvedValue({})
      let sectionIndex = 0
      createMock.mockImplementation(async ({ collection }: { collection: string }) => {
        if (collection === 'exercises') return { id: 'new-ex-1' }
        if (collection === 'sections') {
          sectionIndex += 1
          if (sectionIndex === 2) throw new Error('Section create failed')
          return { id: 'new-sec-1' }
        }
        throw new Error(`Unexpected collection: ${collection}`)
      })

      const req = {
        user: { id: 'user-1' },
        payload: {
          findByID: vi.fn(async ({ collection }: { collection: string }) => {
            if (collection === 'lessons') {
              return { id: 'lesson-1', title: 'Existing', blocks: '[]' }
            }
            return null
          }),
          find: vi.fn().mockResolvedValue({ docs: [] }),
          create: createMock,
          update: vi.fn().mockResolvedValue({}),
          delete: deleteMock,
        },
      } as unknown as PayloadRequest

      const exercise = makeExercise({
        exercise_content: {
          sections: [makeSection(), makeSection({ question_number: 'ב' })],
        },
      })
      const result = await importLessonFromJson(req, {
        targetLessonId: 'lesson-1',
        filename: 'lesson.json',
        json: { topic: 'Topic', exercises: [exercise] },
      })

      expect(result).toMatchObject({
        success: false,
        exercisesCreated: 0,
        exercisesFailed: 1,
        lessonId: 'lesson-1',
      })

      const deletedTargets = deleteMock.mock.calls.map(([c]) => `${c.collection}:${c.id}`)
      expect(deletedTargets).toEqual(['sections:new-sec-1', 'exercises:new-ex-1'])
      expect(deletedTargets).not.toContain('lessons:lesson-1')
    })

    it('returns not_found when targetLessonId does not resolve to a lesson', async () => {
      const req = {
        user: { id: 'user-1' },
        payload: {
          findByID: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockResolvedValue({ docs: [] }),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      } as unknown as PayloadRequest

      const result = await importLessonFromJson(req, {
        targetLessonId: 'nope',
        filename: 'lesson.json',
        json: { topic: 'Topic', exercises: [makeExercise()] },
      })

      expect(result).toMatchObject({ kind: 'not_found', message: 'Lesson not found' })
    })

    it('returns validation error when neither chapterId nor targetLessonId is provided', async () => {
      const req = {
        user: { id: 'user-1' },
        payload: {
          findByID: vi.fn(),
          find: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      } as unknown as PayloadRequest

      const result = await importLessonFromJson(req, {
        filename: 'lesson.json',
        json: { topic: 'Topic', exercises: [makeExercise()] },
      })

      expect(result).toMatchObject({ kind: 'validation' })
    })
  })
})
