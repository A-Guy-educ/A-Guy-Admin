/**
 * Materializer stage — scans writer output for `{{SKETCH BEGIN}}…{{SKETCH END}}`
 * fenced blocks and replaces each with concrete DSL/SVG via a focused Gemini
 * call. This is the counterpart to the writer's cognitive-load split: writer
 * emits freeform prose descriptions of visuals, materializer converts each to
 * a concrete visual block.
 *
 * Uses gemini-2.5-flash — same as writer. Each sketch is one call; blocks
 * are processed in parallel with a concurrency cap so a 10-exercise lesson
 * (~10-20 sketches) doesn't sit serially.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

import { buildMaterializerSystemPrompt, buildMaterializerUserPrompt } from './prompt.js'

import { MODEL_MATERIALIZER } from '../models.js'

const DEFAULT_MODEL = MODEL_MATERIALIZER
const CONCURRENCY = 4
// Marker format the writer must emit for freeform sketches. Fenced to allow
// multi-line descriptions without escape gymnastics.
const SKETCH_FENCE_RE = /\{\{\s*SKETCH\s+BEGIN\s*\}\}([\s\S]*?)\{\{\s*SKETCH\s+END\s*\}\}/g

export interface MaterializeResult {
  text: string
  sketchCount: number
  succeeded: number
  failed: number
  errors: string[]
}

interface SketchHit {
  index: number
  fullMatch: string
  description: string
}

function findSketches(text: string): SketchHit[] {
  const hits: SketchHit[] = []
  let match: RegExpExecArray | null
  SKETCH_FENCE_RE.lastIndex = 0
  while ((match = SKETCH_FENCE_RE.exec(text)) !== null) {
    hits.push({
      index: match.index,
      fullMatch: match[0],
      description: match[1].trim(),
    })
  }
  return hits
}

async function materializeOne(
  description: string,
  contextHint: string | undefined,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.')

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: DEFAULT_MODEL,
    systemInstruction: buildMaterializerSystemPrompt(),
    generationConfig: {
      temperature: 0.2, // Layout is deterministic-ish; keep low.
      maxOutputTokens: 8192,
    },
  })
  const result = await model.generateContent(buildMaterializerUserPrompt(description, contextHint))
  return result.response.text().trim()
}

function cleanMaterializerOutput(raw: string): string {
  let s = raw.trim()
  // Strip accidental code fences.
  if (s.startsWith('```')) {
    const first = s.indexOf('\n')
    if (first !== -1) s = s.slice(first + 1)
  }
  if (s.endsWith('```')) s = s.slice(0, -3).trimEnd()
  return s
}

/**
 * Indent every line of a materialized block by 2 spaces so it fits inside
 * the v2 format's field layout (which expects indented sub-content under
 * `* שרטוט מותאם לסעיף:`).
 */
function indentBlock(block: string): string {
  return block
    .split('\n')
    .map((line) => (line.trim() ? `  ${line}` : line))
    .join('\n')
}

/**
 * Run the materializer on a full writer output. For each sketch fence, call
 * the materializer and splice its result back in. Runs sketches in parallel
 * with a concurrency cap.
 */
export async function materializeSketches(rawText: string): Promise<MaterializeResult> {
  const hits = findSketches(rawText)
  if (hits.length === 0) {
    return { text: rawText, sketchCount: 0, succeeded: 0, failed: 0, errors: [] }
  }

  // Concurrency-limited parallel materialization. Preserves the original
  // order of hits so we can splice by index-descending later.
  const results: Array<{ hit: SketchHit; concrete: string | null; error?: string }> = []
  const chunks: SketchHit[][] = []
  for (let i = 0; i < hits.length; i += CONCURRENCY) {
    chunks.push(hits.slice(i, i + CONCURRENCY))
  }
  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map((hit) => materializeOne(hit.description, undefined)),
    )
    settled.forEach((res, i) => {
      const hit = chunk[i]
      if (res.status === 'fulfilled') {
        results.push({ hit, concrete: cleanMaterializerOutput(res.value) })
      } else {
        results.push({
          hit,
          concrete: null,
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        })
      }
    })
  }

  // Splice back in descending index order so earlier indices remain valid.
  results.sort((a, b) => b.hit.index - a.hit.index)
  let text = rawText
  const errors: string[] = []
  let succeeded = 0
  let failed = 0
  for (const r of results) {
    const { hit, concrete, error } = r
    const replacement =
      concrete !== null
        ? indentBlock(concrete)
        : // Fallback: leave the original description with a warning comment so
          // a human can hand-fix.
          `  {{SKETCH-MATERIALIZATION-FAILED: ${error ?? 'unknown'} — original description: ${hit.description}}}`
    text = text.slice(0, hit.index) + replacement + text.slice(hit.index + hit.fullMatch.length)
    if (concrete !== null) succeeded += 1
    else {
      failed += 1
      if (error) errors.push(error)
    }
  }

  return { text, sketchCount: hits.length, succeeded, failed, errors }
}
