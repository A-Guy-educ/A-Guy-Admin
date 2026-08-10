/**
 * Diagnostic dump for the function-graph DSL. Reads a lesson (.txt or .json),
 * pulls every function block out, runs it through parseFunctionDsl, and reports
 * exactly which elements the axis renderer will receive.
 *
 * Cross-reference the output against axisElements.ts:
 *   - `graphs` → renderGraphs
 *   - `points` → renderAxisPoints
 *   - `asymptotesVertical/Horizontal` → renderVertical/HorizontalAsymptotes
 *   - `lineBetweenPoints` → renderLineBetweenPoints
 *   - `geometricLoci` → renderGeometricLoci (x=c / y=c fast path + implicitcurve fallback)
 *
 * Usage:
 *   pnpm exec tsx scripts/debug-function-blocks.ts <path-to-lesson>
 */

import { promises as fs } from 'fs'
import path from 'path'

import { parseFunctionDsl } from '@/server/services/lesson-json-import/parse-function-dsl'
import { parseTextLesson } from '@/server/services/text-lesson-import/parse-text'

interface FunctionSite {
  where: string
  dsl: string
}

function collectFromText(rawTxt: string): FunctionSite[] {
  const lesson = parseTextLesson(rawTxt)
  const sites: FunctionSite[] = []
  for (const ex of lesson.exercises) {
    if (ex.function) sites.push({ where: `ex ${ex.exerciseNumber} [shared]`, dsl: ex.function })
    for (const section of ex.sections) {
      if (section.function) {
        sites.push({
          where: `ex ${ex.exerciseNumber} section ${section.questionNumber}`,
          dsl: section.function,
        })
      }
    }
  }
  return sites
}

interface JsonExercise {
  exercise_number: string | number
  exercise_content: {
    data?: { function?: string }
    sections: { question_number?: string; question: { function?: string } }[]
  }
}

function collectFromJson(rawJson: string): FunctionSite[] {
  const lesson = JSON.parse(rawJson) as { exercises: JsonExercise[] }
  const sites: FunctionSite[] = []
  for (const ex of lesson.exercises) {
    if (ex.exercise_content.data?.function) {
      sites.push({
        where: `ex ${ex.exercise_number} [shared]`,
        dsl: ex.exercise_content.data.function,
      })
    }
    for (const section of ex.exercise_content.sections) {
      if (section.question.function) {
        sites.push({
          where: `ex ${ex.exercise_number} section ${section.question_number}`,
          dsl: section.question.function,
        })
      }
    }
  }
  return sites
}

function summarize(site: FunctionSite): void {
  const { spec, errors } = parseFunctionDsl(site.dsl)
  const graphs = spec.elements.graphs.length
  const points = spec.elements.points.length
  const lines = spec.elements.lineBetweenPoints?.length ?? 0
  const asymV = spec.elements.asymptotesVertical?.length ?? 0
  const asymH = spec.elements.asymptotesHorizontal?.length ?? 0
  const loci = spec.elements.geometricLoci?.length ?? 0

  const parts: string[] = []
  if (graphs) parts.push(`${graphs} graph(s)`)
  if (points) parts.push(`${points} point(s)`)
  if (lines) parts.push(`${lines} line(s)`)
  if (asymV) parts.push(`${asymV} v-asymptote(s)`)
  if (asymH) parts.push(`${asymH} h-asymptote(s)`)
  if (loci) parts.push(`${loci} locus/loci (implicit or x=c / y=c)`)

  console.log(`\n${site.where}`)
  console.log(`   viewport: ${JSON.stringify(spec.viewport)}`)
  console.log(`   → ${parts.length ? parts.join(', ') : '(nothing)'}`)

  if (loci) {
    for (const l of spec.elements.geometricLoci!) {
      console.log(`      • ${l.equation}`)
    }
  }
  const nanPoints = spec.elements.points.filter(
    (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y),
  )
  if (nanPoints.length) {
    console.log(`   ⚠ ${nanPoints.length} point(s) have NaN coords — JSXGraph will throw`)
    for (const p of nanPoints) console.log(`      • (${p.x}, ${p.y}) label=${p.label ?? '-'}`)
  }
  if (errors.length) {
    console.log(`   parse errors:`)
    for (const e of errors) console.log(`      • ${e}`)
  }
}

async function main(): Promise<void> {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: tsx scripts/debug-function-blocks.ts <lesson-file>')
    process.exit(1)
  }

  const raw = await fs.readFile(inputPath, 'utf8')
  const ext = path.extname(inputPath).toLowerCase()
  const sites = ext === '.json' ? collectFromJson(raw) : collectFromText(raw)

  console.log(`Found ${sites.length} function block(s) in ${inputPath}`)

  for (const site of sites) summarize(site)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
