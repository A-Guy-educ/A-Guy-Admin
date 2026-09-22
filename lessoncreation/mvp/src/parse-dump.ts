/**
 * Parse the `=== LESSON ===` DB-state dump format into LessonModel.
 *
 * The dumps in lessonassesment/dumps/ come from an admin export tool and
 * follow a strict indentation scheme:
 *
 *   === LESSON ===
 *   Id: <id>
 *   Title: <title>
 *   Type: <type>   Locale: he   Status: <status>
 *   Chapter: <chapter>   Course: <course>
 *   ...
 *   Total exercises: N
 *
 *   === EXERCISE N :: <title> (id <id>) ===
 *   order: N   slug: <slug>
 *   blocks: M
 *
 *     --- Block N :: type=<type> (id <id>) ---
 *     variant:
 *       mcq
 *     prompt: <inline JSON on one line>
 *     answer: <inline JSON on one line>
 *     ...
 *
 * question_select / question_free_response blocks store their fields as
 * inline JSON — that's what we care about for validation. rich_text and svg
 * blocks are tracked minimally (kind + id) since the CRITICAL rules don't
 * look inside them yet.
 */
import type {
  Block,
  ExerciseModel,
  FreeResponseBlock,
  LessonModel,
  McqBlock,
  McqOption,
} from './types.js'

const LESSON_HEADER_RE = /^=== LESSON ===$/
const LESSON_ID_RE = /^Id:\s*(.+)$/
const LESSON_TITLE_RE = /^Title:\s*(.+)$/
const LESSON_TYPE_LINE_RE = /^Type:\s*(\S+)/
const LESSON_CHAPTER_LINE_RE = /^Chapter:\s*(.+?)\s{2,}Course:\s*(.+)$/
const EXERCISE_HEADER_RE = /^=== EXERCISE\s+(\d+)\s*::\s*(.+?)\s*\(id\s+\S+\)\s*===$/
const BLOCK_HEADER_RE = /^\s{2}---\s+Block\s+\d+\s*::\s*type=(\S+)\s*\(id\s+(\S+)\)\s*---$/
const FIELD_INLINE_RE = /^\s{2}(\w+):\s+(.+)$/
const FIELD_MULTILINE_START_RE = /^\s{2}(\w+):\s*$/

interface RawAnswer {
  multiSelect?: boolean
  options?: Array<{
    id?: string
    content?: { value?: string }
  }>
  correctOptionIds?: string[]
  acceptedAnswers?: string[]
}

interface RawRichText {
  value?: string
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function toRichText(raw: string | null): { value: string } | undefined {
  if (!raw) return undefined
  const parsed = safeParseJson<RawRichText>(raw)
  if (!parsed || typeof parsed.value !== 'string') return undefined
  return { value: parsed.value }
}

function toMcqOptions(raw: RawAnswer | null): McqOption[] {
  if (!raw?.options) return []
  return raw.options
    .filter((o) => typeof o.id === 'string')
    .map((o) => ({
      id: o.id!,
      text: o.content?.value ?? '',
    }))
}

/**
 * Parse a single block from the collected block-lines. Only question blocks
 * are fully materialized; other block types get a minimal shape so the
 * exercise's block list remains accurate.
 */
function parseBlock(
  type: string,
  blockId: string,
  fields: Map<string, string>,
  multiline: Map<string, string>,
): Block | null {
  if (type === 'question_select') {
    const answer = safeParseJson<RawAnswer>(fields.get('answer') ?? '')
    const prompt = toRichText(fields.get('prompt') ?? null) ?? { value: '' }
    const hint = toRichText(fields.get('hint') ?? null)
    const solution = toRichText(fields.get('solution') ?? null)
    const fullSolution = toRichText(fields.get('fullSolution') ?? null)
    const block: McqBlock = {
      kind: 'mcq',
      blockId,
      prompt,
      options: toMcqOptions(answer),
      correctOptionIds: answer?.correctOptionIds ?? [],
      hint,
      solution,
      fullSolution,
    }
    return block
  }

  if (type === 'question_free_response') {
    const answer = safeParseJson<RawAnswer>(fields.get('answer') ?? '')
    const prompt = toRichText(fields.get('prompt') ?? null) ?? { value: '' }
    const hint = toRichText(fields.get('hint') ?? null)
    const solution = toRichText(fields.get('solution') ?? null)
    const fullSolution = toRichText(fields.get('fullSolution') ?? null)
    const block: FreeResponseBlock = {
      kind: 'free_response',
      blockId,
      prompt,
      acceptedAnswers: answer?.acceptedAnswers ?? [],
      hint,
      solution,
      fullSolution,
    }
    return block
  }

  if (type === 'rich_text') {
    return {
      kind: 'rich_text',
      blockId,
      value: multiline.get('value') ?? '',
    }
  }

  if (type === 'svg') {
    return {
      kind: 'svg',
      blockId,
      svg: multiline.get('value') ?? '',
    }
  }

  return null
}

/**
 * Parser state machine. The dumps mix single-line inline-JSON fields with
 * multi-line `key:\n  <indented content>` fields — we track which mode we're
 * in per-block and flush blocks on the next block header or exercise header.
 */
export function parseDump(text: string): LessonModel {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  let lessonId = ''
  let lessonTitle = ''
  let lessonType = ''
  let lessonChapter = ''
  let lessonCourse = ''

  const exercises: ExerciseModel[] = []

  let currentExercise: ExerciseModel | null = null

  let currentBlockType: string | null = null
  let currentBlockId: string | null = null
  const currentFields = new Map<string, string>()
  const currentMultiline = new Map<string, string>()
  let currentMultilineKey: string | null = null
  const currentMultilineLines: string[] = []

  const flushBlock = () => {
    if (currentBlockType && currentBlockId) {
      if (currentMultilineKey) {
        currentMultiline.set(currentMultilineKey, currentMultilineLines.join('\n').trim())
      }
      const block = parseBlock(currentBlockType, currentBlockId, currentFields, currentMultiline)
      if (block && currentExercise) currentExercise.blocks.push(block)
    }
    currentBlockType = null
    currentBlockId = null
    currentFields.clear()
    currentMultiline.clear()
    currentMultilineKey = null
    currentMultilineLines.length = 0
  }

  const flushExercise = () => {
    flushBlock()
    if (currentExercise) exercises.push(currentExercise)
    currentExercise = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (LESSON_HEADER_RE.test(line)) continue

    // Top-of-file lesson metadata (only meaningful before any exercise).
    if (!currentExercise) {
      const idM = line.match(LESSON_ID_RE)
      if (idM) {
        lessonId = idM[1].trim()
        continue
      }
      const titleM = line.match(LESSON_TITLE_RE)
      if (titleM) {
        lessonTitle = titleM[1].trim()
        continue
      }
      const typeM = line.match(LESSON_TYPE_LINE_RE)
      if (typeM) {
        lessonType = typeM[1].trim()
        continue
      }
      const chapM = line.match(LESSON_CHAPTER_LINE_RE)
      if (chapM) {
        lessonChapter = chapM[1].trim()
        lessonCourse = chapM[2].trim()
        continue
      }
    }

    // Exercise header — flush any in-flight block/exercise first.
    const exM = line.match(EXERCISE_HEADER_RE)
    if (exM) {
      flushExercise()
      currentExercise = {
        index: Number(exM[1]),
        title: exM[2].trim(),
        blocks: [],
      }
      continue
    }

    // Block header inside the current exercise.
    const blM = line.match(BLOCK_HEADER_RE)
    if (blM) {
      flushBlock()
      currentBlockType = blM[1]
      currentBlockId = blM[2]
      continue
    }

    // No active block → nothing to record from this line.
    if (!currentBlockType) continue

    // Inline field: `  key: value` (JSON on single line).
    const inlineM = line.match(FIELD_INLINE_RE)
    if (inlineM) {
      // Flush any in-flight multi-line field first.
      if (currentMultilineKey) {
        currentMultiline.set(currentMultilineKey, currentMultilineLines.join('\n').trim())
        currentMultilineKey = null
        currentMultilineLines.length = 0
      }
      currentFields.set(inlineM[1], inlineM[2])
      continue
    }

    // Start of a multi-line field: `  key:` with no value.
    const startM = line.match(FIELD_MULTILINE_START_RE)
    if (startM) {
      if (currentMultilineKey) {
        currentMultiline.set(currentMultilineKey, currentMultilineLines.join('\n').trim())
      }
      currentMultilineKey = startM[1]
      currentMultilineLines.length = 0
      continue
    }

    // Any 4-space-indented content line belongs to the current multi-line
    // field. Blank lines inside multi-line values are preserved so SVG /
    // rich-text formatting round-trips faithfully enough for later rules.
    if (currentMultilineKey && (line.startsWith('    ') || line.trim() === '')) {
      // Strip the 4-space prefix so the value isn't over-indented.
      const stripped = line.startsWith('    ') ? line.slice(4) : line
      currentMultilineLines.push(stripped)
      continue
    }

    // Otherwise: sentinel line (e.g., blank line before next block) — end
    // the multi-line collection if active.
    if (currentMultilineKey && line.trim() === '') {
      currentMultilineLines.push('')
    }
  }

  flushExercise()

  return {
    id: lessonId,
    title: lessonTitle,
    type: lessonType,
    chapter: lessonChapter,
    course: lessonCourse,
    exercises,
  }
}
