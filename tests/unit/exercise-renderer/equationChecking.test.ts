import { describe, it, expect } from 'vitest'
import {
  checkQuestionAnswer,
  getInitialAnswer,
  isAutoGradedAnswer,
} from '@/ui/shared/exerciserenderer/utils/answerChecking'
import { ExerciseBlockDefaults } from '@/server/payload/collections/Exercises/defaults'
import { ContentBlockSchema } from '@/server/payload/collections/Exercises/schemas'
import type { QuestionEquationBlock } from '@/server/payload/collections/Exercises/types'

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
