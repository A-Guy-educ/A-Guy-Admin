/**
 * Regression runner: parse every dump in lessonassesment/dumps/, run the
 * validator, write a per-lesson report to lessoncreation/mvp/generated-reports/,
 * and print a summary comparing our automated CRITICAL count against the
 * human-authored CRITICAL count parsed out of lessonassesment/*.md.
 *
 * The comparison is coarse-grained (count-level, not per-finding matching)
 * — good enough for MVP to prove the rules are firing where a human found
 * something serious.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { parseDump } from './parse-dump.js'
import { renderReport } from './report.js'
import { validate } from './validate.js'

const REPO_ROOT = process.cwd()
const DUMPS_DIR = resolve(REPO_ROOT, 'lessonassesment', 'dumps')
const HUMAN_REPORTS_DIR = resolve(REPO_ROOT, 'lessonassesment')
const OUT_DIR = resolve(REPO_ROOT, 'lessoncreation', 'mvp', 'generated-reports')

/** Pull the CRITICAL count out of a human-authored `.md` report's summary line. */
function readHumanCriticalCount(lessonKey: string): number | null {
  try {
    const path = resolve(HUMAN_REPORTS_DIR, `${lessonKey}.md`)
    const md = readFileSync(path, 'utf8')
    const m = md.match(/קריטיים\s*:\s*(\d+)/)
    if (!m) return null
    return Number(m[1])
  } catch {
    return null
  }
}

interface RowResult {
  file: string
  title: string
  ourCritical: number
  ourHigh: number
  ourMedium: number
  ourLow: number
  humanCritical: number | null
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const files = readdirSync(DUMPS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()

  const rows: RowResult[] = []

  for (const file of files) {
    const raw = readFileSync(resolve(DUMPS_DIR, file), 'utf8')
    const lesson = parseDump(raw)
    const report = validate(lesson)

    const outName = file.replace(/\.txt$/, '.md')
    writeFileSync(resolve(OUT_DIR, outName), renderReport(report), 'utf8')

    const lessonKey = basename(file, '.txt')
    const humanCritical = readHumanCriticalCount(lessonKey)

    rows.push({
      file,
      title: lesson.title,
      ourCritical: report.summary.CRITICAL,
      ourHigh: report.summary.HIGH,
      ourMedium: report.summary.MEDIUM,
      ourLow: report.summary.LOW,
      humanCritical,
    })
  }

  // Print summary table.
  console.log('')
  console.log('=== Regression Summary ===')
  console.log('')
  const header = 'Lesson'.padEnd(35) + 'ours(C/H/M/L)'.padEnd(18) + 'human(C)'.padEnd(10) + 'coverage'
  console.log(header)
  console.log('-'.repeat(header.length))

  let totalOurCrit = 0
  let totalHumanCrit = 0
  let dumpsWithFindings = 0

  for (const row of rows) {
    const ours = `${row.ourCritical}/${row.ourHigh}/${row.ourMedium}/${row.ourLow}`
    const human = row.humanCritical == null ? '-' : String(row.humanCritical)
    const coverage =
      row.humanCritical == null
        ? '-'
        : row.humanCritical === 0
          ? row.ourCritical === 0
            ? 'OK'
            : `+${row.ourCritical} false?`
          : row.ourCritical >= row.humanCritical
            ? `OK (${row.ourCritical}/${row.humanCritical})`
            : `MISS (${row.ourCritical}/${row.humanCritical})`

    const title = row.title.length > 30 ? row.title.slice(0, 30) + '…' : row.title
    console.log(title.padEnd(35) + ours.padEnd(18) + human.padEnd(10) + coverage)

    totalOurCrit += row.ourCritical
    if (row.humanCritical != null) totalHumanCrit += row.humanCritical
    if (row.ourCritical > 0 || row.ourHigh > 0) dumpsWithFindings += 1
  }

  console.log('')
  console.log(`Files scanned : ${rows.length}`)
  console.log(`With findings : ${dumpsWithFindings}`)
  console.log(`Total CRITICAL (ours) : ${totalOurCrit}`)
  console.log(`Total CRITICAL (human, where known) : ${totalHumanCrit}`)
  console.log('')
  console.log(`Per-lesson reports written to: lessoncreation/mvp/generated-reports/`)
}

main()
