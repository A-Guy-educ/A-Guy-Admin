/**
 * Lesson-level fields (formulas, common mistakes, explanations, …) and the
 * lesson's own block stream, as carried by the lesson export/import files
 * (v2 text and full JSON). Shared so both formats export and re-import the
 * same set of fields.
 */
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

type Doc = Record<string, unknown>

/** Lesson field → Hebrew label used in the v2 text format. */
export const LESSON_DETAIL_LABELS = {
  topic: 'נושא',
  lessonObjective: 'מטרת השיעור',
  intro: 'פתיח',
  publicExplanation: 'הסבר',
  estimatedMinutes: 'זמן משוער בדקות',
  description: 'תיאור',
  formulas: 'נוסחאות',
  examples: 'דוגמאות',
  commonMistakes: 'טעויות נפוצות',
  additionalNotes: 'הערות נוספות',
  lessonContextText: 'טקסט הקשר',
} as const

export type LessonDetailKey = keyof typeof LESSON_DETAIL_LABELS

export const LESSON_DETAIL_KEYS = Object.keys(LESSON_DETAIL_LABELS) as LessonDetailKey[]

export type LessonDetails = Partial<
  Record<Exclude<LessonDetailKey, 'estimatedMinutes'>, string> & { estimatedMinutes: number }
>

/** Coerce a raw value into the field's stored type; blank / invalid values drop out. */
function cleanValue(key: LessonDetailKey, value: unknown): string | number | undefined {
  if (key === 'estimatedMinutes') {
    const n = typeof value === 'string' ? Number(value.trim()) : value
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Pick the set lesson-detail fields from a lesson doc (or an imported file's lesson object). */
export function pickLessonDetails(source: Doc): LessonDetails {
  const out: Record<string, string | number> = {}
  for (const key of LESSON_DETAIL_KEYS) {
    const value = cleanValue(key, source[key])
    if (value !== undefined) out[key] = value
  }
  return out as LessonDetails
}

/** Parse `label → raw text` pairs (from the v2 text format) into lesson details. */
export function lessonDetailsFromLabels(byLabel: Record<string, string>): LessonDetails {
  const byKey: Doc = {}
  for (const key of LESSON_DETAIL_KEYS) {
    if (LESSON_DETAIL_LABELS[key] in byLabel) byKey[key] = byLabel[LESSON_DETAIL_LABELS[key]]
  }
  return pickLessonDetails(byKey)
}

function isEmptyBlock(block: unknown): boolean {
  const b = block as { type?: unknown; value?: unknown } | null
  return b?.type === 'rich_text' && typeof b.value === 'string' && b.value.trim() === ''
}

/**
 * The lesson's block stream, or [] when it only holds the empty placeholder a
 * new lesson starts with (nothing worth exporting or keeping on append).
 */
export function meaningfulLessonBlocks(lesson: Doc): unknown[] {
  const blocks = (lesson.content as { blocks?: unknown[] } | undefined)?.blocks
  if (!Array.isArray(blocks) || blocks.every(isEmptyBlock)) return []
  return blocks
}

/**
 * Lesson update for an import into an EXISTING lesson: imported details only
 * fill fields the lesson leaves blank (never overwrite), and imported blocks
 * are appended after the lesson's own blocks.
 */
export function lessonUpdateForAppend(
  existing: Doc,
  details: LessonDetails,
  blocks: ContentBlock[],
): Doc {
  const filled = Object.fromEntries(
    Object.entries(details).filter(
      ([key]) => cleanValue(key as LessonDetailKey, existing[key]) === undefined,
    ),
  )
  if (blocks.length === 0) return filled
  return {
    ...filled,
    content: { blocks: [...meaningfulLessonBlocks(existing), ...blocks] },
  }
}
