/**
 * Converts an exercise document into the canonical content export format.
 *
 * Canonical format:
 * {
 *   exercise_number: string,   // 1-indexed position
 *   level: string,             // exercise level (default "1")
 *   exercise_content: {
 *     data: { text, table, PNG, svg },   // non-question blocks
 *     sections: [{                     // question blocks
 *       section_data: { text, table, PNG, svg },
 *       question_number: string,       // א, ב, ג...
 *       question: { text, table, PNG, svg },
 *       hint: { text, table, PNG, svg },
 *       solution: { text, table, PNG, svg },
 *       full_solution: { text, table, PNG, svg },
 *       correct_option: { text, table, PNG, svg },
 *       wrong_options: [{ text, table, PNG, svg }, ...]
 *     }]
 *   }
 * }
 *
 * @fileType utility
 * @domain lessons
 * @pattern lesson-export
 * @ai-summary Converts exercise content blocks to canonical export format.
 */
import type {
  ContentBlock,
  ContentData,
  InlineRichText,
  QuestionAnswer,
} from '@/server/payload/collections/Exercises/types'
import {
  geometrySpecToSvg,
  axisSpecToSvg,
} from '@/server/services/lesson-duplication/graphics-to-svg'
import { GeometrySpecV1Schema } from '@/infra/contracts/graphics/geometry.v1'
import { AxisSpecV1Schema } from '@/infra/contracts/graphics/axis.v1'

import { axisSpecToDsl } from './axis-spec-to-dsl'
import { geometrySpecToDsl } from './geometry-spec-to-dsl'

// -------------------------------------------
// Types for canonical format
// -------------------------------------------

export interface CanonicalTextContent {
  text: string
  table: null
  PNG: string
  svg: string
  /**
   * Hebrew DSL block for round-trippable graph/geometry data. Function graphs
   * are emitted as `%%% … %%%` fences (parsed by parse-function-dsl.ts);
   * geometry diagrams as `--- נקודות --- …` (parsed by parse-geometry-dsl.ts).
   * When both DSL and SVG are populated, the serializer emits DSL (the
   * importer will reconstruct the SVG). SVG is retained as a fallback for
   * raw `svg` blocks and for geometry/axis specs that fail to serialize.
   */
  graphDsl?: string
  /** Geometry part of graphDsl — v2 text emits it under `* שרטוט …:`. */
  geometryDsl?: string
  /** Function-graph part of graphDsl — v2 text emits it under `* גרף …:`. */
  functionDsl?: string
}

export type CanonicalQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'open_ended'
  | 'matching'
  | 'table'

export interface CanonicalTable {
  headers: string[]
  rowsData: string[][]
  /** `"rowIdx-colIdx"` → correct value for fillable cells. */
  answers: Record<string, string>
}

export interface CanonicalSection {
  section_data: CanonicalTextContent
  question_number: string
  question: CanonicalTextContent
  hint: CanonicalTextContent
  solution: CanonicalTextContent
  full_solution: CanonicalTextContent
  correct_option: CanonicalTextContent
  wrong_options: CanonicalTextContent[]
  question_type?: CanonicalQuestionType
  /** MCQ options in authored order with correctness (supports multi-correct). */
  options?: Array<{ text: string; correct: boolean }>
  table?: CanonicalTable
  matching_pairs?: Array<{ left: string; right: string }>
}

export interface CanonicalExerciseContent {
  data: CanonicalTextContent
  sections: CanonicalSection[]
}

export interface CanonicalExercise {
  exercise_number: string
  level: string
  exercise_content: CanonicalExerciseContent
}

export interface CanonicalLessonExport {
  class: string
  lesson_number: string
  topic: string
  exercises: CanonicalExercise[]
  meta: {
    renderedSvgCount: number
    renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }>
  }
}

// -------------------------------------------
// Hebrew ordinal conversion
// -------------------------------------------

const HEBREW_LETTERS = [
  'א',
  'ב',
  'ג',
  'ד',
  'ה',
  'ו',
  'ז',
  'ח',
  'ט',
  'י',
  'יא',
  'יב',
  'יג',
  'יד',
  'טו',
  'טז',
  'יז',
  'יח',
  'יט',
  'כ',
]

function toHebrewOrdinal(n: number): string {
  if (n <= HEBREW_LETTERS.length) {
    return HEBREW_LETTERS[n - 1]
  }
  // For larger numbers, fallback to decimal representation
  return String(n)
}

// -------------------------------------------
// Content wrapper conversion
// -------------------------------------------

/**
 * Convert an InlineRichText to canonical { text, table, PNG, svg } format.
 * LaTeX content (which comes as {latex: string}) is treated as text.
 */
function wrapTextContent(
  content: InlineRichText | string | undefined | null,
): CanonicalTextContent {
  if (!content) {
    return { text: '', table: null, PNG: '', svg: '' }
  }
  if (typeof content === 'string') {
    return { text: content, table: null, PNG: '', svg: '' }
  }
  // InlineRichText has type, format, value, mediaIds
  return { text: content.value || '', table: null, PNG: '', svg: '' }
}

// -------------------------------------------
// Block type detection
// -------------------------------------------

function isRichTextBlock(
  block: ContentBlock,
): block is import('@/server/payload/collections/Exercises/types').RichTextBlock {
  return block.type === 'rich_text'
}

function isLatexBlock(
  block: ContentBlock,
): block is import('@/server/payload/collections/Exercises/types').LatexBlock {
  return block.type === 'latex'
}

function isSvgBlock(
  block: ContentBlock,
): block is import('@/server/payload/collections/Exercises/types').SvgBlock {
  return block.type === 'svg'
}

function isQuestionGeometryBlock(
  block: ContentBlock,
): block is import('@/server/payload/collections/Exercises/types').QuestionGeometryBlock {
  return block.type === 'question_geometry'
}

function isQuestionAxisBlock(
  block: ContentBlock,
): block is import('@/server/payload/collections/Exercises/types').QuestionAxisBlock {
  return block.type === 'question_axis'
}

// -------------------------------------------
// Question content extraction
// -------------------------------------------

type AnyAnswer =
  | QuestionAnswer
  | import('@/server/payload/collections/Exercises/types').TrueFalseAnswer
  | import('@/server/payload/collections/Exercises/types').McqAnswer
  | import('@/server/payload/collections/Exercises/types').FreeResponseAnswer

interface QuestionContent {
  prompt: InlineRichText
  hint?: InlineRichText
  solution?: InlineRichText
  fullSolution?: InlineRichText
  answer?: AnyAnswer
  geometrySpec?: unknown
  axisSpec?: unknown
}

function extractQuestionContent(block: ContentBlock): QuestionContent | null {
  switch (block.type) {
    case 'question_select':
      return {
        prompt: block.prompt,
        hint: block.hint,
        solution: block.solution,
        fullSolution: block.fullSolution,
        answer: block.answer as AnyAnswer,
      }
    case 'question_free_response':
      return {
        prompt: block.prompt,
        hint: block.hint,
        solution: block.solution,
        fullSolution: block.fullSolution,
        answer: block.answer as AnyAnswer,
      }
    case 'question_table':
      return {
        prompt: block.prompt,
        hint: block.hint,
        solution: block.solution,
        fullSolution: block.fullSolution,
        answer: undefined,
      }
    case 'question_matching':
      return {
        prompt: block.prompt,
        hint: block.hint,
        solution: block.solution,
        fullSolution: block.fullSolution,
        answer: undefined,
      }
    case 'question_geometry':
      return {
        prompt: block.prompt,
        hint: block.hint,
        solution: block.solution,
        fullSolution: block.fullSolution,
        answer: block.answer as AnyAnswer,
        geometrySpec: block.geometry,
      }
    case 'question_axis':
      return {
        prompt: block.prompt,
        hint: block.hint,
        solution: block.solution,
        fullSolution: block.fullSolution,
        answer: block.answer as AnyAnswer,
        axisSpec: block.axis,
      }
    default:
      return null
  }
}

// -------------------------------------------
// MCQ option splitting
// -------------------------------------------

function splitMcqOptions(
  answer: import('@/server/payload/collections/Exercises/types').McqAnswer,
): {
  correct: import('@/server/payload/collections/Exercises/types').McqOption
  wrong: import('@/server/payload/collections/Exercises/types').McqOption[]
} {
  const correctOptions: import('@/server/payload/collections/Exercises/types').McqOption[] = []
  const wrongOptions: import('@/server/payload/collections/Exercises/types').McqOption[] = []

  for (const option of answer.options) {
    if (answer.correctOptionIds.includes(option.id)) {
      correctOptions.push(option)
    } else {
      wrongOptions.push(option)
    }
  }

  if (correctOptions.length === 0 && answer.options.length > 0) {
    correctOptions.push(answer.options[0])
    wrongOptions.push(...answer.options.slice(1))
  }

  return { correct: correctOptions[0], wrong: wrongOptions }
}

/**
 * Copy the answer structure of a question block (MCQ options, table body,
 * matching pairs) onto the canonical section, plus its question type.
 */
function applyQuestionStructure(section: CanonicalSection, block: ContentBlock): void {
  switch (block.type) {
    case 'question_select': {
      if (block.variant !== 'mcq') {
        section.question_type = 'open_ended'
        return
      }
      const correctIds = new Set(block.answer.correctOptionIds)
      section.question_type =
        block.selectionMode === 'multiple' || correctIds.size > 1
          ? 'multiple_choice'
          : 'single_choice'
      section.options = block.answer.options.map((o) => ({
        text: o.content?.value ?? '',
        correct: correctIds.has(o.id),
      }))
      const { correct, wrong } = splitMcqOptions(block.answer)
      if (correct) section.correct_option = wrapTextContent(correct.content)
      section.wrong_options = wrong.map((opt) => wrapTextContent(opt.content))
      return
    }
    case 'question_table':
      section.question_type = 'table'
      section.table = {
        headers: [...block.table.headers],
        rowsData: block.table.rowsData.map((row) => [...row]),
        answers: { ...(block.table.answers ?? {}) },
      }
      return
    case 'question_matching': {
      section.question_type = 'matching'
      const leftById = new Map(block.leftColumn.map((o) => [o.id, o.content?.value ?? '']))
      const rightById = new Map(block.rightColumn.map((o) => [o.id, o.content?.value ?? '']))
      section.matching_pairs = block.correctPairs
        .filter((p) => leftById.has(p.optionId) && rightById.has(p.matchId))
        .map((p) => ({ left: leftById.get(p.optionId)!, right: rightById.get(p.matchId)! }))
      return
    }
    default:
      section.question_type = 'open_ended'
  }
}

interface VisualBucket {
  geoDsls: string[]
  fnDsls: string[]
  svgs: string[]
}

function newVisualBucket(): VisualBucket {
  return { geoDsls: [], fnDsls: [], svgs: [] }
}

function visualFields(
  visual: VisualBucket,
): Pick<CanonicalTextContent, 'svg' | 'graphDsl' | 'geometryDsl' | 'functionDsl'> {
  const all = [...visual.fnDsls, ...visual.geoDsls]
  return {
    svg: visual.svgs.filter(Boolean).join('\n'),
    ...(all.length > 0 ? { graphDsl: all.join('\n\n') } : {}),
    ...(visual.geoDsls.length > 0 ? { geometryDsl: visual.geoDsls.join('\n') } : {}),
    ...(visual.fnDsls.length > 0 ? { functionDsl: visual.fnDsls.join('\n\n') } : {}),
  }
}

// -------------------------------------------
// Section-level block walker
// -------------------------------------------

interface SectionWalkResult {
  section: CanonicalSection
  renderedSvgCount: number
  renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }>
}

/**
 * Walk a Payload section's content.blocks and produce one CanonicalSection.
 *
 * A section typically carries an intro (rich_text/latex/svg) followed by a
 * single question block. If multiple question blocks appear in one section,
 * only the first contributes to question/hint/options — the rest are ignored
 * so this stays one-section-in / one-section-out.
 */
/**
 * Serialize an axis block's spec. Prefers DSL (round-trippable through
 * parseFunctionDsl); falls back to SVG when DSL emits nothing. Records a
 * validation failure if the spec doesn't parse.
 */
function serializeAxis(
  axis: unknown,
  blockIndex: number,
  blockType: string,
  bucket: VisualBucket,
  renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }>,
): number {
  if (!axis) return 0
  const parsed = AxisSpecV1Schema.safeParse(axis)
  if (!parsed.success) {
    renderFailures.push({
      blockIndex,
      blockType,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    })
    return 0
  }
  const dsl = axisSpecToDsl(parsed.data)
  if (dsl) {
    bucket.fnDsls.push(dsl)
    return 1
  }
  const svg = axisSpecToSvg(parsed.data)
  if (svg) {
    bucket.svgs.push(svg)
    return 1
  }
  return 0
}

/** Serialize a geometry block's spec. Same policy as serializeAxis. */
function serializeGeometry(
  geometry: unknown,
  blockIndex: number,
  blockType: string,
  bucket: VisualBucket,
  renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }>,
): number {
  if (!geometry) return 0
  const parsed = GeometrySpecV1Schema.safeParse(geometry)
  if (!parsed.success) {
    renderFailures.push({
      blockIndex,
      blockType,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    })
    return 0
  }
  const dsl = geometrySpecToDsl(parsed.data)
  if (dsl) {
    bucket.geoDsls.push(dsl)
    return 1
  }
  const svg = geometrySpecToSvg(parsed.data)
  if (svg) {
    bucket.svgs.push(svg)
    return 1
  }
  return 0
}

/**
 * Serialize an attachment carried on a question block. Covers axis/geometry
 * via DSL; svg attachments pass through as raw markup.
 */
function serializeAttachment(
  attachment: unknown,
  blockIndex: number,
  bucket: VisualBucket,
  renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }>,
): number {
  if (!attachment || typeof attachment !== 'object') return 0
  const att = attachment as {
    kind?: string
    axis?: unknown
    geometry?: unknown
    svg?: { value?: string }
  }
  if (att.kind === 'axis') {
    return serializeAxis(att.axis, blockIndex, 'attachment.axis', bucket, renderFailures)
  }
  if (att.kind === 'geometry') {
    return serializeGeometry(
      att.geometry,
      blockIndex,
      'attachment.geometry',
      bucket,
      renderFailures,
    )
  }
  if (att.kind === 'svg' && att.svg?.value) {
    bucket.svgs.push(att.svg.value)
    return 1
  }
  return 0
}

function hasInlineRichText(rt: InlineRichText | undefined | null): boolean {
  return !!rt && typeof rt.value === 'string' && rt.value.trim().length > 0
}

function sectionDocToCanonical(
  sectionDoc: Record<string, unknown>,
  sectionIndex: number,
): SectionWalkResult {
  const content = sectionDoc.content as ContentData | undefined
  const blocks = content?.blocks || []

  const introTexts: string[] = []
  const visual = newVisualBucket()
  let renderedSvgCount = 0
  const renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }> = []

  const section: CanonicalSection = {
    section_data: { text: '', table: null, PNG: '', svg: '' },
    question_number: toHebrewOrdinal(sectionIndex + 1),
    question: { text: '', table: null, PNG: '', svg: '' },
    hint: { text: '', table: null, PNG: '', svg: '' },
    solution: { text: '', table: null, PNG: '', svg: '' },
    full_solution: { text: '', table: null, PNG: '', svg: '' },
    correct_option: { text: '', table: null, PNG: '', svg: '' },
    wrong_options: [],
  }

  let seenQuestion = false

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]

    if (isRichTextBlock(block)) {
      const t = wrapTextContent(block).text
      if (t) introTexts.push(t)
      continue
    }
    if (isLatexBlock(block)) {
      if (block.latex) introTexts.push(block.latex)
      continue
    }
    if (isSvgBlock(block)) {
      if (block.value) visual.svgs.push(block.value)
      continue
    }
    if (isQuestionGeometryBlock(block)) {
      renderedSvgCount += serializeGeometry(
        block.geometry,
        blockIndex,
        'question_geometry',
        visual,
        renderFailures,
      )
      // Visual-only geometry (empty prompt) MUST NOT consume the question
      // role — the real question block comes next in the section.
      if (!hasInlineRichText(block.prompt)) continue
      if (seenQuestion) continue
      seenQuestion = true
      const qc = extractQuestionContent(block)
      if (qc) {
        section.question = wrapTextContent(qc.prompt)
        section.hint = wrapTextContent(qc.hint)
        section.solution = wrapTextContent(qc.solution)
        section.full_solution = wrapTextContent(qc.fullSolution)
      }
      continue
    }
    if (isQuestionAxisBlock(block)) {
      renderedSvgCount += serializeAxis(
        block.axis,
        blockIndex,
        'question_axis',
        visual,
        renderFailures,
      )
      if (!hasInlineRichText(block.prompt)) continue
      if (seenQuestion) continue
      seenQuestion = true
      const qc = extractQuestionContent(block)
      if (qc) {
        section.question = wrapTextContent(qc.prompt)
        section.hint = wrapTextContent(qc.hint)
        section.solution = wrapTextContent(qc.solution)
        section.full_solution = wrapTextContent(qc.fullSolution)
      }
      continue
    }
    const qc = extractQuestionContent(block)
    if (qc && !seenQuestion) {
      seenQuestion = true
      section.question = wrapTextContent(qc.prompt)
      section.hint = wrapTextContent(qc.hint)
      section.solution = wrapTextContent(qc.solution)
      section.full_solution = wrapTextContent(qc.fullSolution)

      // Attachment on the question block (axis / geometry / svg) joins the
      // section's visual stack.
      const maybeAttachment = (block as { attachment?: unknown }).attachment
      renderedSvgCount += serializeAttachment(maybeAttachment, blockIndex, visual, renderFailures)

      applyQuestionStructure(section, block)
    }
  }

  section.section_data = {
    text: introTexts.filter(Boolean).join('\n'),
    table: null,
    PNG: '',
    ...visualFields(visual),
  }

  return { section, renderedSvgCount, renderFailures }
}

// -------------------------------------------
// Main conversion function
// -------------------------------------------

export interface ExerciseToCanonicalResult {
  exercise: CanonicalExercise
  renderedSvgCount: number
  renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }>
}

/**
 * Convert a modern exercise + its pre-fetched Payload sections to canonical
 * form. One Payload section = one CanonicalSection. The exercise's own
 * content.blocks contribute only to exercise-level intro (data). This is the
 * right path for exercises authored under the Sections collection; use
 * exerciseToCanonical for legacy exercises that keep question blocks inline.
 */
export function exerciseWithSectionsToCanonical(
  exerciseDoc: Record<string, unknown>,
  sectionDocs: Record<string, unknown>[],
  exerciseIndex: number,
): ExerciseToCanonicalResult {
  const exerciseContent = exerciseDoc.content as ContentData | undefined
  const exerciseBlocks = exerciseContent?.blocks || []

  const introTexts: string[] = []
  const visual = newVisualBucket()
  let renderedSvgCount = 0
  const renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }> = []

  for (let blockIndex = 0; blockIndex < exerciseBlocks.length; blockIndex++) {
    const block = exerciseBlocks[blockIndex]
    if (isRichTextBlock(block)) {
      const t = wrapTextContent(block).text
      if (t) introTexts.push(t)
    } else if (isLatexBlock(block)) {
      if (block.latex) introTexts.push(block.latex)
    } else if (isSvgBlock(block)) {
      if (block.value) visual.svgs.push(block.value)
    } else if (isQuestionAxisBlock(block)) {
      renderedSvgCount += serializeAxis(
        block.axis,
        blockIndex,
        'question_axis',
        visual,
        renderFailures,
      )
    } else if (isQuestionGeometryBlock(block)) {
      renderedSvgCount += serializeGeometry(
        block.geometry,
        blockIndex,
        'question_geometry',
        visual,
        renderFailures,
      )
    }
    // Other question blocks at the exercise level are ignored — modern
    // exercises keep questions on child sections.
  }

  const sections: CanonicalSection[] = []
  for (let i = 0; i < sectionDocs.length; i++) {
    const result = sectionDocToCanonical(sectionDocs[i], i)
    sections.push(result.section)
    renderedSvgCount += result.renderedSvgCount
    renderFailures.push(...result.renderFailures)
  }

  return {
    exercise: {
      exercise_number: String(exerciseIndex + 1),
      level: '1',
      exercise_content: {
        data: {
          text: introTexts.filter(Boolean).join('\n'),
          table: null,
          PNG: '',
          ...visualFields(visual),
        },
        sections,
      },
    },
    renderedSvgCount,
    renderFailures,
  }
}

/**
 * Convert a single exercise document to canonical format.
 *
 * @param exerciseDoc - Raw exercise document from Payload
 * @param exerciseIndex - 0-based index within the lesson's blocks
 */
export function exerciseToCanonical(
  exerciseDoc: Record<string, unknown>,
  exerciseIndex: number,
): ExerciseToCanonicalResult {
  const content = exerciseDoc.content as ContentData | undefined
  const blocks = content?.blocks || []

  const dataParts: CanonicalTextContent[] = []
  const sections: CanonicalSection[] = []
  let renderedSvgCount = 0
  const renderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }> = []

  let sectionIndex = 0

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]
    if (isRichTextBlock(block)) {
      dataParts.push(wrapTextContent(block))
      continue
    }
    if (isLatexBlock(block)) {
      dataParts.push({ text: block.latex, table: null, PNG: '', svg: '' })
      continue
    }
    if (isSvgBlock(block)) {
      dataParts.push({ text: '', table: null, PNG: '', svg: block.value })
      continue
    }
    if (isQuestionGeometryBlock(block)) {
      const qc = extractQuestionContent(block)
      if (!qc?.geometrySpec) continue
      const visual = newVisualBucket()
      const added = serializeGeometry(
        qc.geometrySpec,
        blockIndex,
        'question_geometry',
        visual,
        renderFailures,
      )
      if (added === 0) continue
      renderedSvgCount += added
      sections.push({
        section_data: {
          text: '',
          table: null,
          PNG: '',
          ...visualFields(visual),
        },
        question_number: toHebrewOrdinal(sectionIndex + 1),
        question: wrapTextContent(qc.prompt),
        hint: wrapTextContent(qc.hint),
        solution: wrapTextContent(qc.solution),
        full_solution: wrapTextContent(qc.fullSolution),
        correct_option: { text: '', table: null, PNG: '', svg: '' },
        wrong_options: [],
      })
      sectionIndex++
      continue
    }
    if (isQuestionAxisBlock(block)) {
      const qc = extractQuestionContent(block)
      if (!qc?.axisSpec) continue
      const visual = newVisualBucket()
      const added = serializeAxis(qc.axisSpec, blockIndex, 'question_axis', visual, renderFailures)
      if (added === 0) continue
      renderedSvgCount += added
      sections.push({
        section_data: {
          text: '',
          table: null,
          PNG: '',
          ...visualFields(visual),
        },
        question_number: toHebrewOrdinal(sectionIndex + 1),
        question: wrapTextContent(qc.prompt),
        hint: wrapTextContent(qc.hint),
        solution: wrapTextContent(qc.solution),
        full_solution: wrapTextContent(qc.fullSolution),
        correct_option: { text: '', table: null, PNG: '', svg: '' },
        wrong_options: [],
      })
      sectionIndex++
      continue
    }

    const qc = extractQuestionContent(block)
    if (qc) {
      const visual = newVisualBucket()
      const maybeAttachment = (block as { attachment?: unknown }).attachment
      renderedSvgCount += serializeAttachment(maybeAttachment, blockIndex, visual, renderFailures)

      const section: CanonicalSection = {
        section_data: {
          text: '',
          table: null,
          PNG: '',
          ...visualFields(visual),
        },
        question_number: toHebrewOrdinal(sectionIndex + 1),
        question: wrapTextContent(qc.prompt),
        hint: wrapTextContent(qc.hint),
        solution: wrapTextContent(qc.solution),
        full_solution: wrapTextContent(qc.fullSolution),
        correct_option: { text: '', table: null, PNG: '', svg: '' },
        wrong_options: [],
      }

      applyQuestionStructure(section, block)

      sections.push(section)
      sectionIndex++
    }
  }

  const mergedData: CanonicalTextContent = {
    text: dataParts
      .map((d) => d.text)
      .filter(Boolean)
      .join('\n'),
    table: null,
    PNG: '',
    svg: dataParts
      .map((d) => d.svg)
      .filter(Boolean)
      .join('\n'),
  }

  return {
    exercise: {
      exercise_number: String(exerciseIndex + 1),
      level: '1',
      exercise_content: {
        data: mergedData,
        sections,
      },
    },
    renderedSvgCount,
    renderFailures,
  }
}

// -------------------------------------------
// Build canonical lesson export
// -------------------------------------------

/**
 * Build the complete canonical lesson export structure.
 *
 * When `sectionsByExerciseId` is provided and contains sections for an
 * exercise, the modern section-aware path is taken (one Payload section =
 * one CanonicalSection, exercise.content.blocks contributes only to intro).
 * Exercises without sections fall through to the legacy inline-question
 * path (exerciseToCanonical).
 *
 * @param lessonDoc - Raw lesson document from Payload
 * @param exerciseDocs - Array of exercise documents in blocks order
 * @param className - The grade/class level (e.g., "כיתה ז")
 * @param sectionsByExerciseId - Pre-fetched sections keyed by exercise id
 */
export function buildCanonicalLessonExport(
  lessonDoc: Record<string, unknown>,
  exerciseDocs: Record<string, unknown>[],
  className: string,
  sectionsByExerciseId?: Map<string, Record<string, unknown>[]>,
): CanonicalLessonExport {
  const lessonNumber = String((lessonDoc.order as number) || 1)
  const topic = (lessonDoc.title as string) || ''

  let totalRenderedSvgCount = 0
  const allRenderFailures: Array<{ blockIndex: number; blockType: string; issues: string[] }> = []

  const exercises: CanonicalExercise[] = []
  for (let i = 0; i < exerciseDocs.length; i++) {
    const exerciseDoc = exerciseDocs[i]
    const sections = sectionsByExerciseId?.get(exerciseDoc.id as string) ?? []
    const result =
      sections.length > 0
        ? exerciseWithSectionsToCanonical(exerciseDoc, sections, i)
        : exerciseToCanonical(exerciseDoc, i)
    exercises.push(result.exercise)
    totalRenderedSvgCount += result.renderedSvgCount
    allRenderFailures.push(...result.renderFailures)
  }

  return {
    class: className,
    lesson_number: lessonNumber,
    topic,
    exercises,
    meta: {
      renderedSvgCount: totalRenderedSvgCount,
      renderFailures: allRenderFailures,
    },
  }
}
