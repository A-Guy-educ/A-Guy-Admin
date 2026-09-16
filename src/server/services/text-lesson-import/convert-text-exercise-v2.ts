/**
 * Maps a parsed `TextExerciseV2` (bracketed / geometry-aware format) into
 * the Exercises collection's block stream. Mirrors
 * `convert-text-exercise.ts` for the legacy format but knows how to:
 *   - attach a per-section geometry sketch as `attachment.kind = 'geometry'`
 *     on the question block, or emit a standalone `question_geometry` block
 *     when the section is a visual with no accompanying question, and
 *   - fall back gracefully when the DSL couldn't be parsed cleanly (the
 *     block becomes a review placeholder instead of nuking the whole lesson).
 */
import type {
  ContentBlock,
  InlineRichText,
  QuestionAttachment,
  QuestionFreeResponseBlock,
  QuestionGeometryBlock,
  QuestionSelectMcqBlock,
  RichTextBlock,
} from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'

import type { TextExerciseV2, TextSectionV2 } from './parse-text-v2'

const OPEN_ENDED_PLACEHOLDER = 'תשובה פתוחה — למילוי ידני'

function inlineRichText(value: string): InlineRichText {
  return { type: 'rich_text', format: 'md-math-v1', value, mediaIds: [] }
}

function richTextBlock(value: string): RichTextBlock {
  return { id: generateId(), type: 'rich_text', format: 'md-math-v1', value, mediaIds: [] }
}

function standaloneGeometryBlock(geometry: GeometrySpecV1): QuestionGeometryBlock {
  return {
    id: generateId(),
    type: 'question_geometry',
    prompt: inlineRichText(''),
    layout: 'textRight',
    geometry,
  }
}

function geometryAttachment(geometry: GeometrySpecV1): QuestionAttachment {
  return {
    kind: 'geometry',
    layout: 'textRight',
    geometry,
  }
}

function buildPrompt(section: TextSectionV2): InlineRichText {
  const number = section.questionNumber?.trim()
  const text = section.question ?? ''
  if (number) return inlineRichText(`**${number}.** ${text}`)
  return inlineRichText(text)
}

/**
 * Try to build an MCQ from the source's option list. Requires at least two
 * options and exactly one flagged as correct (multiSelect isn't supported by
 * the v2 authors yet — mirrors the legacy v1 converter).
 */
function tryBuildMcqBlock(section: TextSectionV2): QuestionSelectMcqBlock | null {
  if (section.options.length < 2) return null
  const correctCount = section.options.filter((o) => o.correct).length
  if (correctCount !== 1) return null

  const pool = section.options.map((o) => ({ text: o.text, correct: o.correct }))
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
  if (section.hint) block.hint = inlineRichText(section.hint)
  if (section.fullSolution) block.fullSolution = inlineRichText(section.fullSolution)
  if (section.geometry) block.attachment = geometryAttachment(section.geometry)
  return block
}

/**
 * Free-response fallback for Open Ended sections. The v2 authors don't ship
 * a "correct answer" for open-ended prompts, so we synthesize a placeholder
 * accepted answer that the admin can rewrite in the studio (the schema
 * requires at least one string with min length 1).
 */
function buildFreeResponseBlock(section: TextSectionV2): QuestionFreeResponseBlock {
  const accepted = section.fullSolution?.trim() || OPEN_ENDED_PLACEHOLDER
  const block: QuestionFreeResponseBlock = {
    id: generateId(),
    type: 'question_free_response',
    prompt: buildPrompt(section),
    answer: { acceptedAnswers: [accepted] },
  }
  if (section.hint) block.hint = inlineRichText(section.hint)
  if (section.fullSolution) block.fullSolution = inlineRichText(section.fullSolution)
  if (section.geometry) block.attachment = geometryAttachment(section.geometry)
  return block
}

function unparsableSectionBlock(section: TextSectionV2, reason: string): RichTextBlock {
  const lines = [
    `**⚠ סעיף ${section.questionNumber || '?'} – לא ניתן לייבא אוטומטית**`,
    `סיבה: ${reason}`,
    '',
    `שאלה: ${section.question || '(ריק)'}`,
    section.options.length > 0
      ? `אפשרויות: ${section.options.map((o) => (o.correct ? `${o.text} ✓` : o.text)).join(' | ')}`
      : '',
  ].filter((l) => l !== '')
  return richTextBlock(lines.join('\n'))
}

function buildSectionTitle(section: TextSectionV2, index: number): string {
  const questionNumber = section.questionNumber?.trim()
  if (questionNumber) return `סעיף ${questionNumber}`
  const question = section.question?.trim()
  if (question) return question.slice(0, 60)
  return `סעיף ${index + 1}`
}

function convertSectionToBlocks(section: TextSectionV2): ContentBlock[] {
  // Table / unknown types fall through to an unparsable placeholder so the
  // author sees the raw content and can rebuild it manually — better than
  // silently swallowing the section.
  if (section.type.kind === 'table') {
    return [unparsableSectionBlock(section, 'שאלת השלמת טבלה — אינה נתמכת עדיין בייבוא')]
  }

  const wantsMcq = section.type.kind !== 'free_response' && section.options.length >= 2
  if (wantsMcq) {
    const mcq = tryBuildMcqBlock(section)
    if (mcq) return [mcq]
    // Fall through: MCQ options exist but no correct-marker was set. Degrade
    // to free-response using fullSolution as the accepted answer.
    if (section.fullSolution || section.question) {
      return [buildFreeResponseBlock(section)]
    }
    return [unparsableSectionBlock(section, 'שאלת ברירה ללא סימון [תשובה נכונה] על אף אפשרות')]
  }

  return [buildFreeResponseBlock(section)]
}

export interface ConvertedExerciseV2 {
  sharedBlocks: ContentBlock[]
  sections: Array<{ title: string; blocks: ContentBlock[] }>
}

export function convertTextExerciseV2ToSections(exercise: TextExerciseV2): ConvertedExerciseV2 {
  const sharedBlocks: ContentBlock[] = []
  if (exercise.intro) sharedBlocks.push(richTextBlock(exercise.intro))
  if (exercise.sharedGeometry) sharedBlocks.push(standaloneGeometryBlock(exercise.sharedGeometry))

  return {
    sharedBlocks,
    sections: exercise.sections.map((section, index) => ({
      title: buildSectionTitle(section, index),
      blocks: convertSectionToBlocks(section),
    })),
  }
}

export function buildV2ExerciseTitle(exercise: TextExerciseV2): string {
  // The v2 header's "rest" is usually just "נתוני פתיחה" — not a real subtopic.
  // Anything else (e.g. authors who put a subtopic there) is kept.
  const rest = exercise.headerRest.trim()
  const number = exercise.exerciseNumber
  if (rest && rest !== 'נתוני פתיחה' && rest !== 'פתיחה') {
    return `${rest} — תרגיל ${number}`
  }
  return `תרגיל ${number}`
}
