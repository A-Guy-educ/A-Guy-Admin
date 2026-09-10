/**
 * Shared helpers for partitioning an exercise's flat block stream into the
 * new Sections shape (one section per question block + shared intro).
 *
 * Used by:
 * - `src/server/payload/endpoints/exercises/convert-latex-block.ts` (post-parse
 *   partitioning for the single-exercise "Convert LaTeX Block" button and the
 *   lesson-level pipeline's Stage 3).
 * - `scripts/preview-course-migration.ts` (dry-run preview of the same
 *   partition applied to existing exercises during the migration).
 *
 * The shape returned by `partitionBlocks` is intentionally minimal — pure
 * data, no Payload instance, no DB calls. The caller is responsible for
 * persisting sections and the sectionRef playlist.
 */
import { generateId } from '@/server/payload/collections/Exercises/types'
import type { ContentBlock, RichTextBlock } from '@/server/payload/collections/Exercises/types'

/**
 * Block types that anchor a section. Kept narrow (no `question_geometry`,
 * `question_axis`, `question_multi_axis`, `svg`) so the migration script
 * and the endpoint agree on what counts as a section boundary. The wider
 * selector in `support-block-utils.isQuestionBlock` is a separate concern
 * (support generation) and intentionally not reused here.
 */
export const QUESTION_TYPES = new Set([
  'question_select',
  'question_free_response',
  'question_table',
  'question_matching',
] as const)

export type QuestionType =
  | 'question_select'
  | 'question_free_response'
  | 'question_table'
  | 'question_matching'

/** Type guard: true when `block` is one of the partition-anchor question types. */
export function isQuestion(block: {
  type: string
}): block is ContentBlock & { type: QuestionType } {
  return QUESTION_TYPES.has(block.type as QuestionType)
}

/** Empty rich_text placeholder used when shared blocks end up empty after partitioning. */
export function emptyPlaceholder(): RichTextBlock {
  return {
    id: generateId(),
    type: 'rich_text',
    format: 'md-math-v1',
    value: '',
    mediaIds: [],
  }
}

/** Hebrew alphabet — used for section labels `סעיף א`, `סעיף ב`, etc. */
const HEBREW_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י']

function hebrewLetter(oneBasedIndex: number): string {
  return HEBREW_LETTERS[oneBasedIndex - 1] ?? String(oneBasedIndex)
}

/**
 * Hidden `<!--SEC:label-->` marker set by parseEnumerate for nested sub-items
 * (e.g., `סעיף ג1`, `סעיף ג2`). The marker keeps the label attached to the
 * question so downstream partitioning uses the correct title without needing
 * to change the block schema. Kept in sync with `SECTION_TITLE_MARKER_RE` in
 * the enumerate parser.
 */
const SECTION_TITLE_MARKER_RE = /^<!--SEC:([^>]+?)-->\n?/

/**
 * WeakSet of blocks that the parser has flagged as exercise-level (not part of
 * any section). Used for right-minipage tikz diagrams that structurally sit
 * next to an enumerate rather than inside a specific `\item`. Populated by
 * `markExerciseShared` in the parser; `partitionBlocks` filters these out
 * BEFORE the section walk and returns them as `exerciseSharedBlocks`.
 *
 * WeakSet is safe here because blocks flow parse→partition in the same
 * runtime with no serialization between the two steps.
 */
const exerciseSharedMarks = new WeakSet<object>()

/** Mark a block as exercise-level shared content (top-level tikz outside any \item). */
export function markExerciseShared(block: ContentBlock): void {
  exerciseSharedMarks.add(block)
}

/** True when the block was flagged as exercise-level shared content. */
export function isMarkedExerciseShared(block: ContentBlock): boolean {
  return exerciseSharedMarks.has(block)
}

/**
 * Title for a new section. When the anchor question's prompt starts with a
 * `<!--SEC:...-->` marker (set by parseEnumerate for nested sub-items), use
 * that explicit label — mutates the anchor's prompt to strip the marker so
 * it doesn't leak into rendered content. Otherwise fall back to the default
 * `סעיף א/ב/ג/…` numbering that mirrors what a student sees in the PDF.
 */
export function deriveSectionTitle(sectionContent: ContentBlock[], oneBasedIndex: number): string {
  const anchor = sectionContent.find(isQuestion) as
    | (ContentBlock & { prompt?: { value: string } })
    | undefined
  const prompt = anchor?.prompt?.value ?? ''
  const markerMatch = SECTION_TITLE_MARKER_RE.exec(prompt)
  if (markerMatch && anchor?.prompt) {
    anchor.prompt.value = prompt.slice(markerMatch[0].length)
    return markerMatch[1]
  }
  return `סעיף ${hebrewLetter(oneBasedIndex)}`
}

export interface PartitionResultSection {
  /** Section content blocks. The anchor question is always the LAST block. */
  contentBlocks: ContentBlock[]
  /** Pre-derived title for create payloads. */
  title: string
}

export interface PartitionResult {
  /** Blocks that belong on `exercise.content.blocks` (shared intro). May be
   *  empty; the caller inserts a single empty rich_text placeholder in that
   *  case so `ContentSchema.blocks.min(1)` still holds. */
  exerciseSharedBlocks: ContentBlock[]
  /** One entry per question block, in source order. Each section's content
   *  ends with its anchor question. */
  sections: PartitionResultSection[]
  /** Convenience: true when no questions were present (legacy flat shape). */
  isFlat: boolean
}

/**
 * Partition a flat block stream into shared exercise-level blocks plus one
 * section per question block.
 *
 * Algorithm:
 * - Walk blocks in source order.
 * - Non-question blocks BEFORE the first question land in
 *   `exerciseSharedBlocks`. That's the exercise's intro paragraph (a `נתון…`
 *   context sentence describing the diagram + variables) which should render
 *   ALONGSIDE the right-minipage diagram as a single exercise-level context
 *   block, not be shoved into section א as leading content.
 * - When a question block is encountered: start a new section with that
 *   question as its anchor.
 * - Non-question blocks AFTER a question (e.g., a diagram embedded inside
 *   sub-question 2's item content in the source) attach as TRAILING content
 *   of the CURRENT section — that's the section they belong to semantically.
 * - If no question blocks exist at all, the whole stream is returned as
 *   `exerciseSharedBlocks` and `sections` is empty (`isFlat: true`).
 */
export function partitionBlocks(blocks: ContentBlock[]): PartitionResult {
  if (!blocks.some(isQuestion)) {
    return {
      exerciseSharedBlocks: [...blocks],
      sections: [],
      isFlat: true,
    }
  }

  const exerciseSharedBlocks: ContentBlock[] = []
  const sections: PartitionResultSection[] = []

  for (const block of blocks) {
    if (isQuestion(block)) {
      // Sub-question (marker like `סעיף ד1`, `ד2`, …) — append to the
      // CURRENT section instead of starting a new one, so a parent item with
      // nested `(1)/(2)` sub-parts renders as ONE section (`סעיף ד`) with
      // multiple sub-questions grouped inside rather than nine flat sections.
      if (isSubQuestionMarker(block) && sections.length > 0) {
        stripSectionMarker(block)
        sections[sections.length - 1].contentBlocks.push(block)
        continue
      }
      sections.push({
        contentBlocks: [block],
        title: deriveSectionTitle([block], sections.length + 1),
      })
      continue
    }

    // Non-question. Two shared-cases and one section-attach case:
    //   1. Marked exercise-shared (top-level tikz not inside any `\item`) —
    //      always shared, regardless of source position.
    //   2. Pre-first-question rich_text/tikz (intro paragraph, top-of-
    //      exercise diagram) — shared, so intro + diagram render as one
    //      exercise-level context block instead of being shoved into
    //      section א.
    //   3. Post-question non-question (in-item diagram, trailing prose) —
    //      trailing content of the CURRENT (most recent) section.
    if (isMarkedExerciseShared(block) || sections.length === 0) {
      exerciseSharedBlocks.push(block)
    } else {
      sections[sections.length - 1].contentBlocks.push(block)
    }
  }

  // Fuse `[rich_text, question_axis|question_geometry|question_multi_axis]`
  // pairs in exerciseSharedBlocks into ONE graphics block by absorbing the
  // rich_text into the graphics block's `prompt` slot. The block renderer
  // shows `prompt` as a text area above the graphic, so the intro paragraph
  // and diagram render as a single unified exercise-context block — matching
  // the author's side-by-side minipage layout in the source PDF.
  return {
    exerciseSharedBlocks: absorbIntroIntoGraphics(exerciseSharedBlocks),
    sections,
    isFlat: false,
  }
}

/**
 * True when the question's SEC marker has a numeric suffix (`ד1`, `ה2`, …).
 * Numeric suffix comes from parseEnumerate's inline-`(N)` / nested-enumerate
 * handler for sub-questions. Bare `סעיף ד` is a parent — starts a new section.
 */
function isSubQuestionMarker(block: ContentBlock): boolean {
  const prompt = (block as { prompt?: { value?: string } }).prompt?.value ?? ''
  const match = SECTION_TITLE_MARKER_RE.exec(prompt)
  if (!match) return false
  return /סעיף\s+[֐-׿]\d+/.test(match[1])
}

/**
 * Remove the leading `<!--SEC:...-->` marker from a question's prompt without
 * changing anything else. Used for sub-questions merged into a parent section
 * (only the parent's marker becomes the section title).
 */
function stripSectionMarker(block: ContentBlock): void {
  const q = block as { prompt?: { value?: string } }
  const prompt = q.prompt?.value ?? ''
  const match = SECTION_TITLE_MARKER_RE.exec(prompt)
  if (match && q.prompt) {
    q.prompt.value = prompt.slice(match[0].length)
  }
}

const GRAPHICS_TYPES = new Set(['question_axis', 'question_geometry', 'question_multi_axis'])

interface WithPrompt {
  prompt?: { type: 'rich_text'; format: string; value: string; mediaIds: string[] }
}

function isGraphicsBlock(block: ContentBlock): boolean {
  return GRAPHICS_TYPES.has(block.type)
}

function absorbIntroIntoGraphics(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = []
  const pendingIntro: ContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'rich_text') {
      pendingIntro.push(block)
      continue
    }
    if (isGraphicsBlock(block) && pendingIntro.length > 0) {
      const introText = pendingIntro
        .map((b) => (b as { value?: string }).value ?? '')
        .join('\n\n')
        .trim()
      pendingIntro.length = 0
      const graphics = block as ContentBlock & WithPrompt
      const existing = graphics.prompt?.value ?? ''
      const combined = existing ? `${introText}\n\n${existing}` : introText
      graphics.prompt = {
        type: 'rich_text',
        format: 'md-math-v1',
        value: combined,
        mediaIds: [],
      }
      out.push(block)
      continue
    }
    // Non-graphics, non-rich_text (or graphics with no pending intro) —
    // pass pending rich_text through unchanged (preserves original IDs),
    // then this block.
    out.push(...pendingIntro)
    pendingIntro.length = 0
    out.push(block)
  }
  out.push(...pendingIntro)
  return out
}
