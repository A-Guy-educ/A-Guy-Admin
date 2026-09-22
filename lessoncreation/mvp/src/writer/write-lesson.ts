/**
 * Writer stage — takes a LessonSkeleton and produces a v2-format `.txt`
 * string. Stage 3 of the pipeline (Planner → Critic → Reviser → Writer).
 *
 * Unlike planner/critic/reviser which use structured JSON output, the
 * writer produces freeform Hebrew text (the v2 format is not JSON). We
 * validate the output by calling `parseTextLessonV2` from the main repo
 * — if the parser reproduces our skeleton's 10×4 structure, the writer's
 * output is contract-compliant.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

// Reuse the main repo's parser — the writer's whole job is to produce
// what this parser accepts. Import via relative path since the MVP lives
// outside `src/`.
import { parseTextLessonV2 } from '../../../../src/server/services/text-lesson-import/parse-text-v2.js'
import { materializeSketches } from '../materializer/materialize.js'
import type { LessonSkeleton } from '../planner/schema.js'
import { buildWriterSystemPrompt, buildWriterUserPrompt } from './prompt.js'

export interface WriteResult {
  /** The final v2-format text (post-materialization). */
  text: string
  /** The raw writer output before materialization — kept for debugging degeneration bugs. */
  rawWriterText: string
  /** Parsed structure — if this failed, the writer output is malformed. */
  parseOk: boolean
  parseError?: string
  /** Structural issues found after parsing (missing sections, wrong section count, etc.). */
  structureWarnings: string[]
  /** Materialization stats — how many sketches, how many failed. */
  sketchCount: number
  sketchSucceeded: number
  sketchFailed: number
}

const DEFAULT_MODEL = 'gemini-2.5-flash'

/** Strip any accidental markdown code fences the model might add despite instructions. */
function cleanOutput(raw: string): string {
  let s = raw.trim()
  if (s.startsWith('```')) {
    const firstNewline = s.indexOf('\n')
    if (firstNewline !== -1) s = s.slice(firstNewline + 1)
  }
  if (s.endsWith('```')) {
    s = s.slice(0, -3).trimEnd()
  }
  return s
}

/**
 * Structural check: after parseTextLessonV2 succeeds, verify the parsed
 * output actually has 10 exercises with 4 sections each, matching the
 * skeleton. Returns human-readable warnings — not fatal errors.
 */
/**
 * Counts geometry-DSL rows per exercise's shared-drawing + per-section drawings
 * by scraping the raw text (the parser deduplicates and hides degeneration).
 * The 577-segment bug came from a writer attention loop that kept repeating the
 * same segment; that regression parsed clean and structure-checked clean, but
 * would have rendered as a mess. This is the belt-and-suspenders check.
 */
function countGeometryDegenerationWarnings(rawText: string): string[] {
  const warnings: string[] = []

  // Split by exercise header — each block starts with `[ תרגיל N` or `[ סעיף`.
  const chunks = rawText.split(/^=+$/m)
  let currentExerciseNum = 0
  let currentSectionLetter = ''

  const EXERCISE_HEADER_RE = /^\[\s*תרגיל\s+(\S+)\s*[-–]\s*/m
  const SECTION_HEADER_RE = /^\[\s*(?:תרגיל\s+\S+\s*[-–]\s*)?סעיף\s+(\S+)/m
  const SEGMENT_RE = /^\s*\*\s*(?:קטע|ישר)\b/gm
  const POINT_RE = /^\s*\*\s*נקודה\b/gm

  const SEGMENT_HARD_CAP = 60
  const POINT_HARD_CAP = 30

  for (const chunk of chunks) {
    const exM = chunk.match(EXERCISE_HEADER_RE)
    if (exM) {
      currentExerciseNum = Number.isFinite(Number(exM[1])) ? Number(exM[1]) : currentExerciseNum
      currentSectionLetter = ''
    }
    const secM = chunk.match(SECTION_HEADER_RE)
    if (secM) currentSectionLetter = secM[1]

    const segments = chunk.match(SEGMENT_RE)?.length ?? 0
    const points = chunk.match(POINT_RE)?.length ?? 0
    const loc = currentSectionLetter
      ? `Exercise ${currentExerciseNum} section ${currentSectionLetter}`
      : `Exercise ${currentExerciseNum}`

    if (segments > SEGMENT_HARD_CAP) {
      warnings.push(
        `${loc}: geometry block has ${segments} segments (>${SEGMENT_HARD_CAP} — likely writer-degeneration loop). Rendered drawing will be a mess.`,
      )
    }
    if (points > POINT_HARD_CAP) {
      warnings.push(
        `${loc}: geometry block has ${points} points (>${POINT_HARD_CAP} — likely writer-degeneration or over-complexity).`,
      )
    }

    // Duplicate-segment detection: same "קטע Xxx-Yyy" appearing 3+ times
    // in the same chunk is degeneration.
    const segLines = chunk.match(/^\s*\*\s*(?:קטע|ישר)\s+[^\n|]+/gm) ?? []
    const counts = new Map<string, number>()
    for (const line of segLines) {
      const key = line.replace(/\s+/g, ' ').trim().split('|')[0]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const dupes = Array.from(counts.entries()).filter(([, n]) => n >= 3)
    if (dupes.length > 0) {
      warnings.push(
        `${loc}: ${dupes.length} segment(s) appear 3+ times in this block (writer repetition — sample: "${dupes[0][0]}" ×${dupes[0][1]}).`,
      )
    }
  }

  return warnings
}

function checkStructure(parsed: ReturnType<typeof parseTextLessonV2>, skeleton: LessonSkeleton): string[] {
  const warnings: string[] = []
  if (parsed.exercises.length !== skeleton.exercises.length) {
    warnings.push(
      `Exercise count mismatch: skeleton has ${skeleton.exercises.length}, parsed output has ${parsed.exercises.length}`,
    )
  }
  parsed.exercises.forEach((parsedEx, i) => {
    const expected = skeleton.exercises[i]
    if (!expected) return
    if (parsedEx.sections.length !== 4) {
      warnings.push(
        `Exercise ${expected.number}: expected 4 sections, parsed ${parsedEx.sections.length}`,
      )
    }
    parsedEx.sections.forEach((sec, si) => {
      if (sec.type.kind === 'unknown') {
        warnings.push(
          `Exercise ${expected.number} section ${si + 1}: unknown question type (raw="${sec.type.raw}")`,
        )
      }
      // MCQ: exactly one option marked correct
      if (sec.type.kind === 'mcq') {
        const correctCount = sec.options.filter((o) => o.correct).length
        if (correctCount !== 1) {
          warnings.push(
            `Exercise ${expected.number} section ${si + 1}: MCQ has ${correctCount} correct-marked options (should be 1)`,
          )
        }
        if (sec.options.length !== sec.type.optionsCount) {
          warnings.push(
            `Exercise ${expected.number} section ${si + 1}: MCQ says ${sec.type.optionsCount} options but has ${sec.options.length}`,
          )
        }
      }
    })
  })
  return warnings
}

export async function writeLesson(skeleton: LessonSkeleton): Promise<WriteResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.')

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: DEFAULT_MODEL,
    systemInstruction: buildWriterSystemPrompt(),
    generationConfig: {
      temperature: 0.4,
      // Gemini 2.5 Flash allows up to 65,536 output tokens. Hebrew + embedded
      // SVG burns tokens fast — the earlier ceiling of 32,768 caused silent
      // truncation on longer lessons (exercise 10 partially cut, or dropped).
      maxOutputTokens: 65536,
    },
  })

  const result = await model.generateContent(buildWriterUserPrompt(skeleton))
  const rawWriterText = cleanOutput(result.response.text())

  // Stage 2: materialize all {{SKETCH BEGIN}}…{{SKETCH END}} blocks into
  // concrete DSL or SVG via focused per-sketch Gemini calls. The writer
  // never touches coordinates; the materializer handles layout.
  const materialized = await materializeSketches(rawWriterText)
  const text = materialized.text

  // Parse-validate the FINAL text (post-materialization).
  try {
    const parsed = parseTextLessonV2(text)
    const structureWarnings = [
      ...checkStructure(parsed, skeleton),
      // Raw-text scan — catches DSL-degeneration loops the parser hides via
      // deduplication (see 577-segment regression).
      ...countGeometryDegenerationWarnings(text),
      // Materialization warnings — sketches that couldn't be converted.
      ...(materialized.failed > 0
        ? [
            `${materialized.failed}/${materialized.sketchCount} sketches failed to materialize (${materialized.errors[0] ?? 'unknown'})`,
          ]
        : []),
    ]
    return {
      text,
      rawWriterText,
      parseOk: true,
      structureWarnings,
      sketchCount: materialized.sketchCount,
      sketchSucceeded: materialized.succeeded,
      sketchFailed: materialized.failed,
    }
  } catch (err) {
    return {
      text,
      rawWriterText,
      parseOk: false,
      parseError: err instanceof Error ? err.message : String(err),
      structureWarnings: [],
      sketchCount: materialized.sketchCount,
      sketchSucceeded: materialized.succeeded,
      sketchFailed: materialized.failed,
    }
  }
}
