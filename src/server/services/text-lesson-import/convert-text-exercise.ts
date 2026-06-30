/**
 * Maps a parsed `TextExercise` into the Exercises collection's block stream.
 *
 * Layout the importer emits, in order:
 *   1. Intro narrative as a single rich_text block (skipped if empty)
 *   2. SVG block (skipped if no svg)
 *   3. One question block per section — question_select MCQ when options exist,
 *      question_free_response when they don't.
 *
 * The block order intentionally mirrors how the original text file reads,
 * so the SVG sits between the teacher's narrative and the first question.
 */
import type {
  ContentBlock,
  InlineRichText,
  QuestionFreeResponseBlock,
  QuestionSelectMcqBlock,
  RichTextBlock,
  SvgBlock,
} from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'

import type { TextExercise, TextSection } from './parse-text'

const isNonEmpty = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== ''

function inlineRichText(value: string): InlineRichText {
  return { type: 'rich_text', format: 'md-math-v1', value, mediaIds: [] }
}

function richTextBlock(value: string): RichTextBlock {
  return { id: generateId(), type: 'rich_text', format: 'md-math-v1', value, mediaIds: [] }
}

function svgBlock(value: string): SvgBlock {
  return { id: generateId(), type: 'svg', value }
}

function buildPrompt(section: TextSection): InlineRichText {
  const number = section.questionNumber?.trim()
  const text = section.question ?? ''
  if (number) return inlineRichText(`**${number}.** ${text}`)
  return inlineRichText(text)
}

function buildMcqBlock(section: TextSection): QuestionSelectMcqBlock {
  const wrongs = section.options.filter((o) => o.trim() !== section.correctAnswer.trim())
  // Shuffle so the correct option doesn't always sit first.
  const pool = [
    { text: section.correctAnswer, correct: true },
    ...wrongs.map((t) => ({ text: t, correct: false })),
  ]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  const options = pool.map((o, idx) => ({
    id: `opt-${idx + 1}`,
    content: inlineRichText(o.text),
  }))
  const correctOptionIds = pool
    .map((o, idx) => (o.correct ? `opt-${idx + 1}` : null))
    .filter((id): id is string => id !== null)

  const block: QuestionSelectMcqBlock = {
    id: generateId(),
    type: 'question_select',
    variant: 'mcq',
    selectionMode: 'single',
    prompt: buildPrompt(section),
    answer: { multiSelect: false, options, correctOptionIds },
  }
  if (isNonEmpty(section.hint)) block.hint = inlineRichText(section.hint)
  if (isNonEmpty(section.fullSolution)) block.fullSolution = inlineRichText(section.fullSolution)
  return block
}

function buildFreeResponseBlock(section: TextSection): QuestionFreeResponseBlock {
  const accepted = isNonEmpty(section.correctAnswer) ? section.correctAnswer : 'See solution'
  const block: QuestionFreeResponseBlock = {
    id: generateId(),
    type: 'question_free_response',
    prompt: buildPrompt(section),
    answer: { acceptedAnswers: [accepted] },
  }
  if (isNonEmpty(section.hint)) block.hint = inlineRichText(section.hint)
  if (isNonEmpty(section.fullSolution)) block.fullSolution = inlineRichText(section.fullSolution)
  return block
}

export function convertTextExerciseToBlocks(exercise: TextExercise): ContentBlock[] {
  const blocks: ContentBlock[] = []

  if (isNonEmpty(exercise.intro)) blocks.push(richTextBlock(exercise.intro))
  if (isNonEmpty(exercise.svg)) blocks.push(svgBlock(exercise.svg))

  for (const section of exercise.sections) {
    if (section.type.kind === 'free_response' || section.options.length === 0) {
      blocks.push(buildFreeResponseBlock(section))
    } else {
      blocks.push(buildMcqBlock(section))
    }
  }

  // Defensive — Payload's content schema requires at least one block.
  if (blocks.length === 0) blocks.push(richTextBlock(''))
  return blocks
}

export function buildTextExerciseTitle(exercise: TextExercise): string {
  const subTopic = exercise.subtopic?.trim()
  const number = exercise.exerciseNumber
  if (subTopic) return `${subTopic} — תרגיל ${number}`
  return `תרגיל ${number}`
}

export function deriveLessonTitle(args: {
  lessonName?: string
  filename: string
  firstExerciseSubtopic?: string
}): string {
  if (isNonEmpty(args.lessonName)) return args.lessonName
  if (isNonEmpty(args.firstExerciseSubtopic)) return args.firstExerciseSubtopic
  // Strip the extension and fall back to the bare filename.
  const base = args.filename.replace(/\.[^.]+$/, '')
  return base || 'שיעור ללא שם'
}
