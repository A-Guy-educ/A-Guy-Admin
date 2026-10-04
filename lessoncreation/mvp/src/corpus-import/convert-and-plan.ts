/**
 * Corpus-import stage: format B → format A conversion + reverse-planned
 * LessonSkeleton. Two-stage architecture to avoid output truncation:
 *
 *   Stage 1: reverse-planner (one JSON call → LessonSkeleton)
 *   Stage 2: per-exercise converter (one text call per exercise, sequential,
 *            with last 1-2 already-converted exercises as continuity context)
 *
 * Why not a single combined call? Empirically the single-call version
 * truncated the v2 text mid-lesson — after emitting a full skeleton in the
 * JSON response, the model ran out of output budget before finishing the
 * text (dropped E10 in an ~10-exercise lesson). The two-stage split
 * bounds each call's output to ~2-3k tokens per exercise, so truncation
 * is a non-issue.
 *
 * The reader critic still runs on the rendered v2 text — the skeleton is
 * a scaffold for the plan-fidelity axis, not ground truth.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

import { generateJson } from '../gemini-client.js'
import { withHttpRetry } from '../http-retry.js'
import { MODEL_CORPUS_IMPORT } from '../models.js'
import { LessonSkeleton } from '../planner/schema.js'
import {
  buildConvertExerciseSystemPrompt,
  buildConvertExerciseUserPrompt,
  buildReversePlannerSystemPrompt,
  buildReversePlannerUserPrompt,
  type CorpusImportInput,
} from './prompt.js'

export interface CorpusImportOutput {
  /** The lesson text converted to format A (v2), parseable by parseTextLessonV2. */
  v2Text: string
  /** Reverse-planned LessonSkeleton inferred from the lesson content. */
  skeleton: LessonSkeleton
}

const CONTINUITY_WINDOW = 2

/**
 * Stage 1: reverse-plan the LessonSkeleton from the format-B lesson. Uses
 * structured JSON output (schema-validated). Single call per lesson.
 */
async function reversePlan(input: CorpusImportInput): Promise<LessonSkeleton> {
  return generateJson({
    systemInstruction: buildReversePlannerSystemPrompt(),
    userPrompt: buildReversePlannerUserPrompt(input),
    schema: LessonSkeleton,
    modelName: MODEL_CORPUS_IMPORT,
    temperature: 0.2,
    // Skeleton alone is ~3-5k tokens — plenty of budget at 32k.
    maxOutputTokens: 32768,
  })
}

/** Strip accidental markdown code fences from freeform text output. */
function cleanExerciseOutput(raw: string): string {
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
 * Stage 2 (per-exercise): call Gemini to convert one exercise from the
 * source format-B lesson into format A. Freeform text output (not JSON).
 */
async function convertOneExercise(
  input: CorpusImportInput,
  exerciseNumber: number,
  priorConvertedText: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.')

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: MODEL_CORPUS_IMPORT,
    systemInstruction: buildConvertExerciseSystemPrompt(),
    generationConfig: {
      temperature: 0.2,
      // One exercise's format-A output is ~2-4k tokens. 16k gives
      // generous headroom for the longer exercises (word problems with
      // full step-by-step solutions).
      maxOutputTokens: 16384,
    },
  })
  const result = await withHttpRetry(
    () =>
      model.generateContent(
        buildConvertExerciseUserPrompt({ input, exerciseNumber, priorConvertedText }),
      ),
    { label: `convert E${exerciseNumber} ${MODEL_CORPUS_IMPORT}` },
  )
  return cleanExerciseOutput(result.response.text())
}

/**
 * Sanity check: does the converted exercise's text actually contain the
 * expected `[ תרגיל N - נתוני פתיחה ]` header? If not, the model went
 * off-script (produced a different exercise, wrapped the output in
 * unexpected framing, etc.) and we should surface the error.
 */
function assertExerciseHeader(text: string, exerciseNumber: number): void {
  const re = new RegExp(`\\[\\s*תרגיל\\s+${exerciseNumber}\\s*[-–]\\s*נתוני\\s+פתיחה\\s*\\]`)
  if (!re.test(text)) {
    throw new Error(
      `Convert output for exercise ${exerciseNumber} is missing the expected "[ תרגיל ${exerciseNumber} - נתוני פתיחה ]" header. Got: ${text.slice(0, 200)}…`,
    )
  }
}

export async function convertAndPlan(input: CorpusImportInput): Promise<CorpusImportOutput> {
  // Stage 1: reverse-plan the skeleton.
  const skeleton = await reversePlan(input)

  // Stage 2: for each exercise in the skeleton, convert to format A.
  const converted: string[] = []
  for (const ex of skeleton.exercises) {
    const priorText = converted.slice(-CONTINUITY_WINDOW).join('\n\n')
    const exerciseText = await convertOneExercise(input, ex.number, priorText)
    assertExerciseHeader(exerciseText, ex.number)
    converted.push(exerciseText)
  }

  return {
    v2Text: converted.join('\n\n'),
    skeleton,
  }
}
