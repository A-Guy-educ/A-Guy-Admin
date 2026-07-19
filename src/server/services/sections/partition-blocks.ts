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

/**
 * Title for a new section derived from its anchor question block.
 *
 * Strategy:
 * 1. First line of the question prompt, truncated to 60 chars.
 * 2. Fallback: first non-empty rich_text block in the section's content
 *    (its first line, truncated).
 * 3. Final fallback: `Section N` (1-based index).
 */
export function deriveSectionTitle(sectionContent: ContentBlock[], fallbackIndex: number): string {
  const firstLine = (text: string): string => {
    const line = text.split('\n')[0]?.trim() ?? ''
    return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line
  }

  const anchor = sectionContent.find(isQuestion)
  if (anchor) {
    const prompt = (anchor as { prompt?: { value?: string } }).prompt?.value
    if (prompt && prompt.trim()) {
      const line = firstLine(prompt)
      if (line) return line
    }
  }

  for (const block of sectionContent) {
    const value = (block as { value?: string }).value
    if (typeof value === 'string' && value.trim()) {
      const line = firstLine(value)
      if (line) return line
    }
  }

  return `Section ${fallbackIndex}`
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
 * - Shared blocks before the first question go into `exerciseSharedBlocks`.
 * - When a question block is encountered: flush any accumulated shared
 *   blocks for the current section (none for the first question), then start
 *   a new section with that question as its anchor.
 * - Non-question blocks that follow a question become the leading blocks of
 *   the NEXT section, unless we hit another question first (in which case
 *   they belong to that next section).
 * - After the last question, any trailing non-question blocks attach to the
 *   LAST section.
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
  // Blocks waiting to be attached to a section. Two consumers:
  //  - before the first question: stay on the exercise
  //  - between questions OR trailing after the last question: prepend to the
  //    current/last section so the anchor question remains the LAST block.
  let pending: ContentBlock[] = []

  for (const block of blocks) {
    if (isQuestion(block)) {
      // Start a new section. Whatever was pending is the section's leading
      // content (so the anchor question stays last).
      sections.push({
        contentBlocks: [...pending, block],
        title: deriveSectionTitle([...pending, block], sections.length + 1),
      })
      pending = []
      continue
    }

    if (sections.length === 0) {
      // Pre-question region — belongs to the exercise.
      exerciseSharedBlocks.push(block)
    } else {
      // Between questions or trailing after the last question. Defer
      // attachment until we know whether the trailing tail belongs to the
      // current section or — if no further question follows — to the LAST
      // section as leading content (so the question remains last).
      pending.push(block)
    }
  }

  // Trailing non-question blocks after the last question: prepend to the
  // LAST section so the anchor question stays the LAST block.
  if (pending.length > 0 && sections.length > 0) {
    const lastSection = sections[sections.length - 1]
    lastSection.contentBlocks = [...pending, ...lastSection.contentBlocks]
    pending = []
  }

  return {
    exerciseSharedBlocks,
    sections,
    isFlat: false,
  }
}
