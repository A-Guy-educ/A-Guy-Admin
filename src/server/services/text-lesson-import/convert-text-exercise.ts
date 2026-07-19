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

/**
 * Normalize answer strings for comparison so trivial whitespace, en-/em-dash,
 * and curly-quote drift between an option and `correctAnswer` doesn't make
 * them count as different. Curriculum text is hand-edited and inconsistent.
 */
function normalizeAnswer(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
}

/**
 * Try to build an MCQ from the source's options + correctAnswer. Returns null
 * if the inputs can't safely form an MCQ — caller falls back to free response
 * or an error placeholder. The single-option-MCQ case used to nuke the whole
 * lesson via Mongo validation; we explicitly reject it here instead.
 */
function tryBuildMcqBlock(section: TextSection): QuestionSelectMcqBlock | null {
  if (section.options.length < 2) return null

  const correctNorm = normalizeAnswer(section.correctAnswer)
  if (!correctNorm) return null
  const correctIdx = section.options.findIndex((o) => normalizeAnswer(o) === correctNorm)
  if (correctIdx === -1) return null

  const pool = section.options.map((text, idx) => ({ text, correct: idx === correctIdx }))
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

function tryBuildFreeResponseBlock(section: TextSection): QuestionFreeResponseBlock | null {
  if (!isNonEmpty(section.correctAnswer)) return null
  const block: QuestionFreeResponseBlock = {
    id: generateId(),
    type: 'question_free_response',
    prompt: buildPrompt(section),
    answer: { acceptedAnswers: [section.correctAnswer] },
  }
  if (isNonEmpty(section.hint)) block.hint = inlineRichText(section.hint)
  if (isNonEmpty(section.fullSolution)) block.fullSolution = inlineRichText(section.fullSolution)
  return block
}

/**
 * Visible placeholder for a section we couldn't safely convert. The teacher
 * reviewing the draft can fix it manually rather than discovering the lesson
 * silently rolled back.
 */
function unparsableSectionBlock(section: TextSection, reason: string): RichTextBlock {
  const lines = [
    `**⚠ סעיף ${section.questionNumber || '?'} – לא ניתן לייבא אוטומטית**`,
    `סיבה: ${reason}`,
    '',
    `שאלה: ${section.question || '(ריק)'}`,
    section.options.length > 0 ? `אופציות: ${section.options.join(' | ')}` : '',
    section.correctAnswer ? `פתרון נכון בקובץ: ${section.correctAnswer}` : '',
  ].filter((l) => l !== '')
  return richTextBlock(lines.join('\n'))
}

export interface ConvertedExercise {
  sharedBlocks: ContentBlock[]
  sections: Array<{ title: string; blocks: ContentBlock[] }>
}

function buildSectionTitle(section: TextSection, index: number): string {
  const questionNumber = section.questionNumber?.trim()
  if (questionNumber) return `סעיף ${questionNumber}`

  const question = section.question?.trim()
  if (question) return question.slice(0, 60)

  return `סעיף ${index + 1}`
}

function convertSectionToBlocks(section: TextSection): ContentBlock[] {
  const wantsMcq = section.type.kind !== 'free_response' && section.options.length >= 2

  if (wantsMcq) {
    const mcq = tryBuildMcqBlock(section)
    if (mcq) return [mcq]

    const freeResponse = tryBuildFreeResponseBlock(section)
    if (freeResponse) return [freeResponse]

    return [
      unparsableSectionBlock(
        section,
        'MCQ source where פתרון נכון does not match any option, and no free-response fallback available',
      ),
    ]
  }

  const freeResponse = tryBuildFreeResponseBlock(section)
  if (freeResponse) return [freeResponse]

  return [unparsableSectionBlock(section, 'Free-response section is missing פתרון נכון')]
}

export function convertTextExerciseToSections(exercise: TextExercise): ConvertedExercise {
  const sharedBlocks: ContentBlock[] = []
  if (isNonEmpty(exercise.intro)) sharedBlocks.push(richTextBlock(exercise.intro))
  if (isNonEmpty(exercise.svg)) sharedBlocks.push(svgBlock(exercise.svg))

  return {
    sharedBlocks,
    sections: exercise.sections.map((section, index) => ({
      title: buildSectionTitle(section, index),
      blocks: convertSectionToBlocks(section),
    })),
  }
}

export function convertTextExerciseToBlocks(exercise: TextExercise): ContentBlock[] {
  const blocks: ContentBlock[] = []

  if (isNonEmpty(exercise.intro)) blocks.push(richTextBlock(exercise.intro))
  if (isNonEmpty(exercise.svg)) blocks.push(svgBlock(exercise.svg))

  for (const section of exercise.sections) {
    const wantsMcq = section.type.kind !== 'free_response' && section.options.length >= 2

    if (wantsMcq) {
      const mcq = tryBuildMcqBlock(section)
      if (mcq) {
        blocks.push(mcq)
        continue
      }
      // MCQ inputs are sloppy (no option matches correctAnswer, or only one
      // option). Degrade to free response if we at least have a stated answer.
      const fr = tryBuildFreeResponseBlock(section)
      if (fr) {
        blocks.push(fr)
        continue
      }
      blocks.push(
        unparsableSectionBlock(
          section,
          'MCQ source where פתרון נכון does not match any option, and no free-response fallback available',
        ),
      )
      continue
    }

    // Free-response path. Requires a real accepted answer — we no longer
    // silently default to the literal string "See solution".
    const fr = tryBuildFreeResponseBlock(section)
    if (fr) {
      blocks.push(fr)
      continue
    }
    blocks.push(unparsableSectionBlock(section, 'Free-response section is missing פתרון נכון'))
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
