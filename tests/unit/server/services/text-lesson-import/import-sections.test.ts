import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  convertTextExerciseToSections,
  type ConvertedExercise,
} from '@/server/services/text-lesson-import/convert-text-exercise'
import { importTextLessonFromFile } from '@/server/services/text-lesson-import/import-text-lesson'
import type { TextExercise, TextSection } from '@/server/services/text-lesson-import/parse-text'

const { getDefaultTenantIdMock, parseTextLessonMock } = vi.hoisted(() => ({
  getDefaultTenantIdMock: vi.fn(),
  parseTextLessonMock: vi.fn(),
}))

vi.mock('@/server/repos/tenant/get-default-tenant', () => ({
  getDefaultTenantId: getDefaultTenantIdMock,
}))

vi.mock('@/server/services/text-lesson-import/parse-text', () => ({
  parseTextLesson: parseTextLessonMock,
}))

function makeSection(overrides: Partial<TextSection> = {}): TextSection {
  return {
    questionNumber: 'א',
    question: 'Question?',
    options: ['Correct', 'Wrong'],
    correctAnswer: 'Correct',
    type: { kind: 'mcq', optionsCount: 2 },
    ...overrides,
  }
}

function makeExercise(overrides: Partial<TextExercise> = {}): TextExercise {
  return {
    exerciseNumber: '1',
    subtopic: 'Topic',
    intro: 'Shared intro',
    svg: '<svg>shared</svg>',
    sections: [makeSection()],
    ...overrides,
  }
}

describe('convertTextExerciseToSections', () => {
  it('keeps shared setup separate and creates one question stream per source section', () => {
    const longQuestion = 'שאלה ארוכה '.repeat(10)
    const exercise = makeExercise({
      sections: [
        makeSection(),
        makeSection({
          questionNumber: '',
          question: longQuestion,
          options: [],
          correctAnswer: 'Answer',
          type: { kind: 'free_response' },
        }),
      ],
    })

    const converted: ConvertedExercise = convertTextExerciseToSections(exercise)

    expect(converted.sharedBlocks.map((block) => block.type)).toEqual(['rich_text', 'svg'])
    expect(converted.sections[0]).toMatchObject({ title: 'סעיף א' })
    expect(converted.sections[0].blocks.map((block) => block.type)).toEqual(['question_select'])
    expect(converted.sections[1].title).toBe(longQuestion.trim().slice(0, 60))
    expect(converted.sections[1].blocks.map((block) => block.type)).toEqual([
      'question_free_response',
    ])
  })

  it('keeps an unparsable warning in its own section with an index title fallback', () => {
    const exercise = makeExercise({
      intro: '',
      svg: undefined,
      sections: [
        makeSection({
          questionNumber: '',
          question: '',
          options: [],
          correctAnswer: '',
          type: { kind: 'free_response' },
        }),
      ],
    })

    const converted = convertTextExerciseToSections(exercise)

    expect(converted.sharedBlocks).toEqual([])
    expect(converted.sections[0].title).toBe('סעיף 1')
    expect(converted.sections[0].blocks).toHaveLength(1)
    expect(converted.sections[0].blocks[0]).toMatchObject({
      type: 'rich_text',
      value: expect.stringContaining('לא ניתן לייבא אוטומטית'),
    })
  })
})

describe('importTextLessonFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDefaultTenantIdMock.mockResolvedValue('tenant-1')
  })

  it('creates sections sequentially and writes their ordered exercise playlist', async () => {
    parseTextLessonMock.mockReturnValue({
      lessonName: 'Text lesson',
      exercises: [
        makeExercise({
          intro: '',
          svg: undefined,
          sections: [makeSection(), makeSection({ questionNumber: 'ב' })],
        }),
      ],
    })

    const createMock = vi.fn()
    const updateMock = vi.fn().mockResolvedValue({})
    const deleteMock = vi.fn().mockResolvedValue({})
    let sectionIndex = 0

    createMock.mockImplementation(async ({ collection }: { collection: string }) => {
      if (collection === 'lessons') return { id: 'lesson-1', title: 'Text lesson' }
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

    const result = await importTextLessonFromFile(req, {
      chapterId: 'chapter-1',
      filename: 'lesson.txt',
      text: 'source',
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
    parseTextLessonMock.mockReturnValue({
      lessonName: 'Text lesson',
      exercises: [makeExercise({ sections: [makeSection(), makeSection()] })],
    })

    const createMock = vi.fn()
    const updateMock = vi.fn().mockResolvedValue({})
    const deleteMock = vi.fn().mockResolvedValue({})
    let sectionIndex = 0

    createMock.mockImplementation(async ({ collection }: { collection: string }) => {
      if (collection === 'lessons') return { id: 'lesson-1', title: 'Text lesson' }
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

    const result = await importTextLessonFromFile(req, {
      chapterId: 'chapter-1',
      filename: 'lesson.txt',
      text: 'source',
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
