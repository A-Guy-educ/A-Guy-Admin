import { describe, it, expect } from 'vitest'
import {
  checkQuestionAnswer,
  getInitialAnswer,
  isAutoGradedAnswer,
} from '@/ui/shared/exerciserenderer/utils/answerChecking'
import { ExerciseBlockDefaults } from '@/server/payload/collections/Exercises/defaults'
import { ContentBlockSchema } from '@/server/payload/collections/Exercises/schemas'
import type { QuestionEquationBlock } from '@/server/payload/collections/Exercises/types'
import type { EquationOperation } from '@/server/payload/collections/Exercises/linearEquation'

const MESSAGES = {
  invalidAnswerType: 'Invalid answer type',
  selectTrueFalse: 'Select true/false',
  noCorrectAnswer: 'No correct answer',
  selectAnAnswer: 'Select an answer',
  enterAnAnswer: 'Enter an answer',
  unknownVariant: 'Unknown variant',
  validationFailed: 'Validation failed',
  validationError: 'Validation error',
  connectionError: 'Connection error',
}

const block: QuestionEquationBlock = ExerciseBlockDefaults.question_equation()

describe('equation answer checking', () => {
  it('starts with no completed steps', () => {
    expect(getInitialAnswer(block)).toEqual({ type: 'equation', completedSteps: 0 })
  })

  it('is correct only once every step is done', async () => {
    const solved = await checkQuestionAnswer(
      block,
      { type: 'equation', completedSteps: block.steps.length },
      MESSAGES,
    )
    const partial = await checkQuestionAnswer(
      block,
      { type: 'equation', completedSteps: block.steps.length - 1 },
      MESSAGES,
    )
    expect(solved.isCorrect).toBe(true)
    expect(partial.isCorrect).toBe(false)
  })

  it('asks for an answer when no step was done', async () => {
    const result = await checkQuestionAnswer(
      block,
      { type: 'equation', completedSteps: 0 },
      MESSAGES,
    )
    expect(result).toEqual({ isCorrect: false, message: MESSAGES.selectAnAnswer })
  })

  it('rejects a mismatched answer type', async () => {
    const result = await checkQuestionAnswer(block, { type: 'mcq', selectedIds: [] }, MESSAGES)
    expect(result).toEqual({ isCorrect: false, message: MESSAGES.invalidAnswerType })
  })

  it('auto-grades only the final step', () => {
    const answerAt = (completedSteps: number) => ({ type: 'equation' as const, completedSteps })
    expect(isAutoGradedAnswer(block, answerAt(block.steps.length - 1))).toBe(false)
    expect(isAutoGradedAnswer(block, answerAt(block.steps.length))).toBe(true)
  })
})

describe('QuestionEquationBlockSchema', () => {
  const [firstStep] = block.steps

  it('accepts the default block', () => {
    expect(ContentBlockSchema.safeParse(block).success).toBe(true)
  })

  it('rejects a correct option that is not in the step', () => {
    const steps = [{ ...firstStep, correctOptionId: 'missing' }]
    expect(ContentBlockSchema.safeParse({ ...block, steps }).success).toBe(false)
  })

  it('rejects duplicate option ids', () => {
    const [option] = firstStep.options
    const steps = [{ ...firstStep, options: [option, option] }]
    expect(ContentBlockSchema.safeParse({ ...block, steps }).success).toBe(false)
  })

  it('requires at least one step and two options', () => {
    expect(ContentBlockSchema.safeParse({ ...block, steps: [] }).success).toBe(false)
    const steps = [{ ...firstStep, options: firstStep.options.slice(0, 1) }]
    expect(ContentBlockSchema.safeParse({ ...block, steps }).success).toBe(false)
  })

  it('rejects $ delimiters and blank math', () => {
    expect(
      ContentBlockSchema.safeParse({ ...block, equation: { left: '$x$', right: '5' } }).success,
    ).toBe(false)
    expect(
      ContentBlockSchema.safeParse({ ...block, equation: { left: '  ', right: '5' } }).success,
    ).toBe(false)
  })
})

describe('dynamic mode', () => {
  const dynamic: QuestionEquationBlock = {
    ...block,
    mode: 'dynamic',
    steps: [],
    linear: { a: 2, b: 3, c: 1, d: 8 },
  }
  const answerWith = (operations: EquationOperation[]) => ({
    type: 'equation' as const,
    completedSteps: operations.length,
    operations,
  })
  const minusX: EquationOperation = { kind: 'add_x', value: { n: -1, d: 1 } }
  const minus3: EquationOperation = { kind: 'add_number', value: { n: -3, d: 1 } }
  const plus4: EquationOperation = { kind: 'add_number', value: { n: 4, d: 1 } }

  it('is correct once the chosen operations isolate x, detours included', async () => {
    const solved = await checkQuestionAnswer(
      dynamic,
      answerWith([plus4, minusX, minus3, { kind: 'add_number', value: { n: -4, d: 1 } }]),
      MESSAGES,
    )
    const partial = await checkQuestionAnswer(dynamic, answerWith([minusX]), MESSAGES)
    expect(solved.isCorrect).toBe(true)
    expect(partial.isCorrect).toBe(false)
    expect(isAutoGradedAnswer(dynamic, answerWith([minusX, minus3]))).toBe(true)
    expect(isAutoGradedAnswer(dynamic, answerWith([minusX]))).toBe(false)
  })

  it('validates the dynamic block', () => {
    expect(ContentBlockSchema.safeParse(dynamic).success).toBe(true)
    const noLinear = { ...dynamic, linear: undefined }
    const noSolution = { ...dynamic, linear: { a: 2, b: 3, c: 2, d: 8 } }
    const fractional = { ...dynamic, linear: { a: 1.5, b: 3, c: 1, d: 8 } }
    expect(ContentBlockSchema.safeParse(noLinear).success).toBe(false)
    expect(ContentBlockSchema.safeParse(noSolution).success).toBe(false)
    expect(ContentBlockSchema.safeParse(fractional).success).toBe(false)
  })

  it('still requires steps in steps mode', () => {
    expect(ContentBlockSchema.safeParse({ ...block, mode: 'steps', steps: [] }).success).toBe(false)
  })
})
