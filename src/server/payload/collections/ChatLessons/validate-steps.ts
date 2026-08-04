/**
 * @fileType payload-hook
 * @domain chat-lessons
 * @ai-summary beforeChange validator for the `steps` graph inside a chat-lesson
 *             doc: unique stepIds, valid nextStepId references, ≥1 correct
 *             option on graded MCs, exactly one reachable finish step.
 */

import type { CollectionBeforeChangeHook } from 'payload'

type StepOption = {
  text?: string | null
  isCorrect?: boolean | null
  nextStepId?: string | null
}

type Step = {
  blockType?: string
  stepId?: string | null
  text?: string | null
  nextStepId?: string | null
  options?: StepOption[] | null
}

type ChatLessonData = {
  steps?: Step[] | null
}

const collectOutgoing = (step: Step): Array<string | null | undefined> => {
  const edges: Array<string | null | undefined> = [step.nextStepId?.trim() || null]
  if (step.blockType === 'multipleChoice' && Array.isArray(step.options)) {
    for (const option of step.options) {
      edges.push(option?.nextStepId?.trim() || null)
    }
  }
  return edges
}

/**
 * A multipleChoice block is "graded" iff any option opts in to correctness
 * (isCorrect defined, true or false). If no option declares isCorrect at all,
 * the block is treated as an opinion / personality prompt where all answers
 * are acceptable — Web's runner handles this the same way.
 */
const isGradedMultipleChoice = (step: Step): boolean => {
  if (!Array.isArray(step.options)) return false
  return step.options.some((option) => option?.isCorrect === true || option?.isCorrect === false)
}

export const validateChatLessonSteps: CollectionBeforeChangeHook = async ({ data, operation }) => {
  if (operation !== 'create' && operation !== 'update') return data

  // Payload passes the raw incoming patch to collection beforeChange hooks —
  // on a partial update (e.g. toggling `isActive`), `data.steps` is undefined
  // and there is nothing for us to validate. `required: true` on the field
  // still enforces "steps must exist" at create time.
  const rawSteps = (data as ChatLessonData | null)?.steps
  if (rawSteps === undefined) return data

  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error('A chat lesson must have at least one step.')
  }
  const steps = rawSteps

  const stepIds = new Set<string>()
  let finishCount = 0
  let finishStepId: string | null = null

  for (const step of steps) {
    const id = step.stepId?.trim()
    if (!id) throw new Error('Every step must have a non-empty `stepId`.')
    if (stepIds.has(id)) {
      throw new Error(`Duplicate stepId "${id}" — every stepId must be unique within the doc.`)
    }
    stepIds.add(id)

    if (step.blockType === 'finish') {
      finishCount += 1
      finishStepId = id
    }

    if (step.blockType === 'multipleChoice') {
      if (!Array.isArray(step.options) || step.options.length < 2) {
        throw new Error(`multipleChoice step "${id}" must have at least two options.`)
      }
      if (isGradedMultipleChoice(step) && !step.options.some((o) => o?.isCorrect === true)) {
        throw new Error(
          `multipleChoice step "${id}" is graded but has no option marked isCorrect: true.`,
        )
      }
    }
  }

  if (finishCount !== 1) {
    throw new Error(`A chat lesson must have exactly one finish step (found ${finishCount}).`)
  }

  for (const step of steps) {
    for (const edge of collectOutgoing(step)) {
      if (edge && !stepIds.has(edge)) {
        throw new Error(`Step "${step.stepId}" references unknown nextStepId "${edge}".`)
      }
    }
  }

  const startId = steps[0]!.stepId!.trim()
  const reachable = new Set<string>([startId])
  const queue: string[] = [startId]
  const byId = new Map(steps.map((s) => [s.stepId!.trim(), s]))

  while (queue.length > 0) {
    const current = queue.shift()!
    const step = byId.get(current)
    if (!step) continue
    for (const edge of collectOutgoing(step)) {
      if (edge && !reachable.has(edge)) {
        reachable.add(edge)
        queue.push(edge)
      }
    }
  }

  if (finishStepId && !reachable.has(finishStepId)) {
    throw new Error(
      `Finish step "${finishStepId}" is not reachable from the first step "${startId}".`,
    )
  }

  const unreachable = [...stepIds].filter((id) => !reachable.has(id))
  if (unreachable.length > 0) {
    throw new Error(`Unreachable steps from "${startId}": ${unreachable.join(', ')}.`)
  }

  return data
}
