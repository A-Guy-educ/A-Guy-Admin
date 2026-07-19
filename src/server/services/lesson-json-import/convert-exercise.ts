import type {
  ContentBlock,
  InlineRichText,
  QuestionSelectMcqBlock,
  RichTextBlock,
  SvgBlock,
} from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'

import type { LessonJsonContentBlock, LessonJsonExercise, LessonJsonSection } from './json-schema'

const isNonEmpty = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== ''

function inlineRichText(value: string): InlineRichText {
  return {
    type: 'rich_text',
    format: 'md-math-v1',
    value,
    mediaIds: [],
  }
}

function richTextBlock(value: string): RichTextBlock {
  return {
    id: generateId(),
    type: 'rich_text',
    format: 'md-math-v1',
    value,
    mediaIds: [],
  }
}

function svgBlock(value: string): SvgBlock {
  return {
    id: generateId(),
    type: 'svg',
    value,
  }
}

function blocksFromContext(block: LessonJsonContentBlock | undefined): ContentBlock[] {
  if (!block) return []
  const out: ContentBlock[] = []
  if (isNonEmpty(block.svg)) out.push(svgBlock(block.svg))
  if (isNonEmpty(block.text)) out.push(richTextBlock(block.text))
  return out
}

function buildPrompt(section: LessonJsonSection): InlineRichText {
  const number = section.question_number?.trim()
  const text = section.question.text ?? ''
  if (number) return inlineRichText(`**${number}.** ${text}`)
  return inlineRichText(text)
}

function buildQuestionBlock(section: LessonJsonSection): QuestionSelectMcqBlock {
  const correct = section.correct_option.text ?? ''
  const wrongs = section.wrong_options.map((o) => o.text ?? '')

  // Shuffle once so the correct answer doesn't always land in slot 1.
  const all = [
    { text: correct, correct: true },
    ...wrongs.map((t) => ({ text: t, correct: false })),
  ]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }

  const options = all.map((o, idx) => ({
    id: `opt-${idx + 1}`,
    content: inlineRichText(o.text),
  }))
  const correctOptionIds = all
    .map((o, idx) => (o.correct ? `opt-${idx + 1}` : null))
    .filter((id): id is string => id !== null)

  const block: QuestionSelectMcqBlock = {
    id: generateId(),
    type: 'question_select',
    variant: 'mcq',
    selectionMode: 'single',
    prompt: buildPrompt(section),
    answer: {
      multiSelect: false,
      options,
      correctOptionIds,
    },
  }

  if (isNonEmpty(section.hint?.text)) block.hint = inlineRichText(section.hint!.text)
  if (isNonEmpty(section.solution?.text)) block.solution = inlineRichText(section.solution!.text)
  if (isNonEmpty(section.full_solution?.text))
    block.fullSolution = inlineRichText(section.full_solution!.text)

  return block
}

export interface ConvertedExercise {
  sharedBlocks: ContentBlock[]
  sections: Array<{ title: string; blocks: ContentBlock[] }>
}

function buildSectionTitle(section: LessonJsonSection, index: number): string {
  const questionNumber = section.question_number?.trim()
  if (questionNumber) return `סעיף ${questionNumber}`

  const question = section.question.text?.trim()
  if (question) return question.slice(0, 60)

  return `סעיף ${index + 1}`
}

export function convertExerciseToSections(exercise: LessonJsonExercise): ConvertedExercise {
  return {
    sharedBlocks: blocksFromContext(exercise.exercise_content.data),
    sections: exercise.exercise_content.sections.map((section, index) => {
      const blocks = [...blocksFromContext(section.section_data)]
      if (isNonEmpty(section.question.svg)) blocks.push(svgBlock(section.question.svg))
      blocks.push(buildQuestionBlock(section))

      return {
        title: buildSectionTitle(section, index),
        blocks,
      }
    }),
  }
}

export function convertExerciseToBlocks(exercise: LessonJsonExercise): ContentBlock[] {
  const blocks: ContentBlock[] = []

  blocks.push(...blocksFromContext(exercise.exercise_content.data))

  for (const section of exercise.exercise_content.sections) {
    blocks.push(...blocksFromContext(section.section_data))
    if (isNonEmpty(section.question.svg)) blocks.push(svgBlock(section.question.svg!))
    blocks.push(buildQuestionBlock(section))
  }

  if (blocks.length === 0) {
    blocks.push(richTextBlock(''))
  }

  return blocks
}

export function buildExerciseTitle(lessonTopic: string, exercise: LessonJsonExercise): string {
  const subTopic = exercise.topic?.trim()
  const number = exercise.exercise_number
  if (subTopic && subTopic !== lessonTopic) return `${subTopic} — תרגיל ${number}`
  return `תרגיל ${number}`
}
