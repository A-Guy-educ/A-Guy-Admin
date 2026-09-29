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
  QuestionAxisBlock,
  QuestionFreeResponseBlock,
  QuestionGeometryBlock,
  QuestionMatchingBlock,
  QuestionSelectMcqBlock,
  QuestionTableBlock,
  RichTextBlock,
  SvgBlock,
} from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'

import type { TextExerciseV2, TextSectionV2 } from './parse-text-v2'

const OPEN_ENDED_PLACEHOLDER = 'תשובה פתוחה — למילוי ידני'

function inlineRichText(value: string): InlineRichText {
  return { type: 'rich_text', format: 'md-math-v1', value, mediaIds: [] }
}

function richTextBlock(value: string): RichTextBlock {
  return { id: generateId(), type: 'rich_text', format: 'md-math-v1', value, mediaIds: [] }
}

// `displaySize: 'full'` matches the shape the admin's AttachmentEditor /
// GeometrySpecEditor emit when an author manually attaches or inserts a
// visual. The web renderer draws the same block shape the admin produces;
// omitting `displaySize` (even though it's typed as optional) results in
// the sketch not rendering on web — the field is required in practice.
const DEFAULT_DISPLAY_SIZE = 'full' as const

function standaloneGeometryBlock(geometry: GeometrySpecV1): QuestionGeometryBlock {
  return {
    id: generateId(),
    type: 'question_geometry',
    prompt: inlineRichText(''),
    layout: 'textRight',
    geometry,
    displaySize: DEFAULT_DISPLAY_SIZE,
  }
}

function standaloneAxisBlock(axis: AxisSpecV1): QuestionAxisBlock {
  return {
    id: generateId(),
    type: 'question_axis',
    prompt: inlineRichText(''),
    layout: 'textRight',
    axis,
    displaySize: DEFAULT_DISPLAY_SIZE,
  }
}

function svgBlock(value: string): SvgBlock {
  return { id: generateId(), type: 'svg', value }
}

function geometryAttachment(geometry: GeometrySpecV1): QuestionAttachment {
  return {
    kind: 'geometry',
    layout: 'textRight',
    geometry,
    displaySize: DEFAULT_DISPLAY_SIZE,
  }
}

function axisAttachment(axis: AxisSpecV1): QuestionAttachment {
  return {
    kind: 'axis',
    layout: 'textRight',
    axis,
    displaySize: DEFAULT_DISPLAY_SIZE,
  }
}

function svgAttachment(value: string): QuestionAttachment {
  return {
    kind: 'svg',
    layout: 'textRight',
    svg: { value },
    displaySize: DEFAULT_DISPLAY_SIZE,
  }
}

function sectionAttachment(section: TextSectionV2): QuestionAttachment | undefined {
  // Preference order when multiple visuals somehow coexist: geometry DSL is
  // richest, then function graph, then raw SVG. In practice the parser only
  // fills one field per section so this is just belt-and-braces.
  if (section.geometry) return geometryAttachment(section.geometry)
  if (section.functionGraph) return axisAttachment(section.functionGraph)
  if (section.svg) return svgAttachment(section.svg)
  return undefined
}

/**
 * Boss's per-section sketches include the exercise's points/segments in a
 * compressed form but reference the exercise-level circle by bare `* מעגל N`
 * — no `מרכז`/`רדיוס` fields. The section's parsed geometry has zero circles
 * as a result. When that happens, inherit the exercise's shared circles so
 * the section attachment renders the ring the author obviously meant.
 *
 * Preconditions for the inheritance:
 *   - The section HAS its own geometry (points, segments) — we're augmenting,
 *     not injecting from thin air.
 *   - The section recorded at least one bare `מעגל N` reference.
 *   - The section defines no circles of its own (don't overwrite intent).
 *   - The exercise has shared circles to copy.
 *
 * Returns a NEW section object (immutable pattern — the section list came
 * from a fresh parse but the wider codebase treats these objects as frozen).
 */
function withInheritedCircles(section: TextSectionV2, exercise: TextExerciseV2): TextSectionV2 {
  const sharedCircles = exercise.sharedGeometry?.elements.circles
  if (!sharedCircles || sharedCircles.length === 0) return section
  if (!section.geometry) return section
  if ((section.geometry.elements.circles?.length ?? 0) > 0) return section
  if (section.bareCircleRefs.length === 0) return section
  const geometry: GeometrySpecV1 = {
    ...section.geometry,
    elements: {
      ...section.geometry.elements,
      circles: sharedCircles,
    },
  }
  return { ...section, geometry }
}

function buildPrompt(section: TextSectionV2): InlineRichText {
  const number = section.questionNumber?.trim()
  const text = section.question ?? ''
  if (number) return inlineRichText(`**${number}.** ${text}`)
  return inlineRichText(text)
}

/**
 * Try to build an MCQ from the source's option list. Handles both
 * `Single Choice` (exactly one correct) and `Multiple Choice` (>=1
 * correct). Reads `section.type.selectionMode` when the type is `mcq`;
 * otherwise infers single/multiple from the number of `[תשובה נכונה]`
 * markers so legacy sources still work.
 */
function tryBuildMcqBlock(section: TextSectionV2): QuestionSelectMcqBlock | null {
  if (section.options.length < 2) return null
  const correctCount = section.options.filter((o) => o.correct).length
  if (correctCount === 0) return null

  const declaredMultiple = section.type.kind === 'mcq' && section.type.selectionMode === 'multiple'
  const selectionMode: 'single' | 'multiple' =
    declaredMultiple || correctCount > 1 ? 'multiple' : 'single'

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
    selectionMode,
    prompt: buildPrompt(section),
    answer: { multiSelect: selectionMode === 'multiple', options, correctOptionIds },
  }
  if (section.hint) block.hint = inlineRichText(section.hint)
  if (section.fullSolution) block.fullSolution = inlineRichText(section.fullSolution)
  const attachment = sectionAttachment(section)
  if (attachment) block.attachment = attachment
  return block
}

function tryBuildMatchingBlock(section: TextSectionV2): QuestionMatchingBlock | null {
  if (section.matchingPairs.length < 2) return null
  const leftColumn = section.matchingPairs.map((p, idx) => ({
    id: `left-${idx + 1}`,
    content: inlineRichText(p.left),
  }))
  // Right column is shuffled so the source order isn't the answer key. Studio
  // authors can re-order it manually if they want a specific display layout.
  const rightPool = section.matchingPairs.map((p, idx) => ({
    id: `right-${idx + 1}`,
    content: inlineRichText(p.right),
    originalIdx: idx,
  }))
  for (let i = rightPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rightPool[i], rightPool[j]] = [rightPool[j], rightPool[i]]
  }
  const rightColumn = rightPool.map(({ id, content }) => ({ id, content }))
  const correctPairs = section.matchingPairs.map((_, idx) => {
    const right = rightPool.find((r) => r.originalIdx === idx)!
    return { optionId: `left-${idx + 1}`, matchId: right.id }
  })

  const block: QuestionMatchingBlock = {
    id: generateId(),
    type: 'question_matching',
    prompt: buildPrompt(section),
    leftColumn,
    rightColumn,
    correctPairs,
    shuffleRightColumn: true,
  }
  if (section.hint) block.hint = inlineRichText(section.hint)
  if (section.fullSolution) block.fullSolution = inlineRichText(section.fullSolution)
  const attachment = sectionAttachment(section)
  if (attachment) block.attachment = attachment
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
  const attachment = sectionAttachment(section)
  if (attachment) block.attachment = attachment
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

/**
 * Emit a `question_table` block from a parsed `Fill-in Table` section. The
 * table is always in solution-fill mode (that's the point of importing a
 * table question — the student fills the blanks), with correct values in
 * `answers` and blank cells left as empty strings in `rowsData`.
 * Attachments (e.g. `שרטוט מותאם לסעיף`) still hang off the question block.
 */
function buildTableBlock(section: TextSectionV2): QuestionTableBlock | null {
  if (!section.table) return null
  const { headers, rowsData, answers } = section.table
  const block: QuestionTableBlock = {
    id: generateId(),
    type: 'question_table',
    prompt: buildPrompt(section),
    table: {
      solutionFill: true,
      headers,
      rowsData,
      answers,
      showBorders: true,
      showHeader: true,
    },
  }
  if (section.hint) block.hint = inlineRichText(section.hint)
  if (section.fullSolution) block.fullSolution = inlineRichText(section.fullSolution)
  const attachment = sectionAttachment(section)
  if (attachment) block.attachment = attachment
  return block
}

function convertSectionToBlocks(section: TextSectionV2): ContentBlock[] {
  if (section.type.kind === 'table') {
    const table = buildTableBlock(section)
    if (table) return [table]
    // Body was missing (no `* מבנה טבלה (עמודות: …):` line, or no rows) —
    // leave the author a placeholder with the raw prompt so they can rebuild
    // it manually instead of silently swallowing the section.
    return [unparsableSectionBlock(section, 'שאלת השלמת טבלה ללא מבנה טבלה תקין (עמודות/שורות)')]
  }

  if (section.type.kind === 'matching') {
    const matching = tryBuildMatchingBlock(section)
    if (matching) return [matching]
    return [unparsableSectionBlock(section, 'שאלת התאמה ללא זוגות תקינים (צמד N: X <---> Y)')]
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
  // Shared visual is emitted once at the exercise level. Sections deliberately
  // don't inherit it as an attachment — that would double-render the same
  // drawing in every section. Only one visual kind is expected per exercise;
  // if the author somehow supplies more than one we prefer SVG → geometry →
  // function graph (SVG is the most opaque so if it exists it's intentional).
  if (exercise.sharedSvg) sharedBlocks.push(svgBlock(exercise.sharedSvg))
  else if (exercise.sharedGeometry)
    sharedBlocks.push(standaloneGeometryBlock(exercise.sharedGeometry))
  else if (exercise.sharedFunctionGraph)
    sharedBlocks.push(standaloneAxisBlock(exercise.sharedFunctionGraph))

  return {
    sharedBlocks,
    sections: exercise.sections.map((section, index) => {
      const withCircles = withInheritedCircles(section, exercise)
      return {
        title: buildSectionTitle(withCircles, index),
        blocks: convertSectionToBlocks(withCircles),
      }
    }),
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
