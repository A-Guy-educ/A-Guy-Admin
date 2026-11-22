/**
 * Lesson-level sections of the v2 plain-text lesson format, written before the
 * first exercise:
 *
 *   =========================================
 *   [ פרטי השיעור ]
 *   =========================================
 *   * נוסחאות: <first line>
 *     <further lines, indented two spaces>
 *   * טעויות נפוצות: …
 *
 *   =========================================
 *   [ בלוקים של השיעור ]
 *   =========================================
 *   [ <the lesson's blocks as compact JSON — see compact-blocks.ts> ]
 *
 * Continuation lines are indented so text that happens to look like a header
 * (`[ תרגיל 1 - … ]`) stays inside the field. Blocks are JSON because they can
 * be any block type; that keeps them lossless.
 */
import { stringifyLessonFile } from '@/server/services/lesson-full-json/stringify-lesson-file'

import {
  LESSON_DETAIL_KEYS,
  LESSON_DETAIL_LABELS,
  type LessonDetails,
} from './lesson-details-fields'

const EQ_RULE = '='.repeat(41)
const INDENT = '  '

export const LESSON_DETAILS_HEADER_RE = /^\[\s*פרטי\s+השיעור\s*\]\s*$/
export const LESSON_BLOCKS_HEADER_RE = /^\[\s*בלוקים\s+של\s+השיעור\s*\]\s*$/

const FIELD_RE = /^\*\s+([^:]+?)\s*:\s?(.*)$/
const KNOWN_LABELS = new Set<string>(Object.values(LESSON_DETAIL_LABELS))

function emitHeader(title: string, out: string[]): void {
  out.push('', EQ_RULE, `[ ${title} ]`, EQ_RULE)
}

/** Emits nothing for a lesson with no details and no blocks. */
export function emitLessonSections(
  details: LessonDetails,
  compactBlocks: unknown[],
  out: string[],
): void {
  const fields = LESSON_DETAIL_KEYS.filter((key) => details[key] !== undefined)
  if (fields.length > 0) {
    emitHeader('פרטי השיעור', out)
    for (const key of fields) {
      const [first, ...rest] = String(details[key]).replace(/\r\n/g, '\n').split('\n')
      out.push(`* ${LESSON_DETAIL_LABELS[key]}: ${first}`)
      for (const line of rest) out.push(line ? INDENT + line : line)
    }
  }
  if (compactBlocks.length > 0) {
    emitHeader('בלוקים של השיעור', out)
    out.push(stringifyLessonFile(compactBlocks))
  }
}

export type LessonSectionMode = 'details' | 'blocks'

export interface LessonSectionsText {
  /** Hebrew label → raw value (see lessonDetailsFromLabels). */
  detailsByLabel: Record<string, string>
  /** Raw JSON text of the lesson blocks section, if present. */
  blocksJson?: string
}

const isSeparatorLine = (line: string) =>
  !line.startsWith(' ') && line.trim().length >= 10 && /^[=-]+$/.test(line.trim())

/** Line-by-line reader for the lesson sections; the v2 parser decides when a section ends. */
export function createLessonSectionsReader() {
  const detailsByLabel: Record<string, string> = {}
  const blockLines: string[] = []
  let mode: LessonSectionMode | null = null
  let currentLabel: string | null = null

  const consumeDetail = (line: string) => {
    const fm = line.match(FIELD_RE)
    if (fm && KNOWN_LABELS.has(fm[1])) {
      currentLabel = fm[1]
      detailsByLabel[currentLabel] = fm[2]
      return
    }
    if (!currentLabel) return
    const value = line.startsWith(INDENT) ? line.slice(INDENT.length) : line
    detailsByLabel[currentLabel] += `\n${value}`
  }

  return {
    get mode() {
      return mode
    },
    start(next: LessonSectionMode) {
      mode = next
      currentLabel = null
    },
    stop() {
      mode = null
    },
    consume(line: string) {
      if (isSeparatorLine(line)) return
      if (mode === 'details') consumeDetail(line)
      else if (mode === 'blocks') blockLines.push(line)
    },
    result(): LessonSectionsText {
      const blocksJson = blockLines.join('\n').trim()
      return { detailsByLabel, ...(blocksJson ? { blocksJson } : {}) }
    },
  }
}
