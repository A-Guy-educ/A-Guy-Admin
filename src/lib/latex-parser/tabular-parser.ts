/**
 * Parses \begin{tabular}{|c|c|c|} environments into table blocks.
 *
 * Bagrut exam pattern:
 *   \begin{tabular}{|c|c|c|}
 *   \hline
 *   \textbf{Header1} & \textbf{Header2} & \textbf{Header3} \\ \hline
 *   data1 & data2 & data3 \\ \hline
 *   \end{tabular}
 */

import type { QuestionTableBlock } from '@/server/payload/collections/Exercises/types'
import { makeTableBlock } from '@/lib/latex-parser/block-generators'

/**
 * Strip a `{\color{name} content}` group's wrapper (keeping content).
 * Uses brace counting so nested `{...}` inside the content survive.
 */
function stripColorGroup(cell: string): string {
  let out = ''
  let i = 0
  while (i < cell.length) {
    if (cell[i] === '{') {
      const after = cell.slice(i + 1)
      const cmd = /^\s*\\color\{[^}]*\}\s*/.exec(after)
      if (cmd) {
        // Find matching closing brace with nesting
        let depth = 1
        let j = i + 1
        for (; j < cell.length; j++) {
          if (cell[j] === '{') depth++
          else if (cell[j] === '}') {
            depth--
            if (depth === 0) break
          }
        }
        if (depth === 0) {
          out += cell.slice(i + 1 + cmd[0].length, j)
          i = j + 1
          continue
        }
      }
    }
    out += cell[i]
    i++
  }
  return out
}

/** Clean cell content: strip LaTeX formatting, trim whitespace */
function cleanCell(cell: string): string {
  // Sentinel-encode `\$` (literal dollar) so the "unwrap single-math cell"
  // logic below doesn't confuse escaped dollars with math delimiters.
  const DOLLAR_SENTINEL = 'DOLLAR'
  const stripped = stripColorGroup(cell)
    .replace(/\\textcolor\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\color\{[^}]*\}/g, '')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\\$/g, DOLLAR_SENTINEL)
    .trim()
  // Table cells render as text (not math), so surviving `$` shows up
  // literally. Unwrap `$X$` occurrences whose payload is a plain identifier
  // or number (no `\command`, no operators/subscripts) — both when the whole
  // cell is one math expression (`$78$` → `78`) and when math is mixed with
  // text (`$x$ (שעות ברשתות)` → `x (שעות ברשתות)`).
  const flat = stripped.replace(/\$([^$\\]{1,20})\$/g, (whole, inner: string) => {
    const trimmed = inner.trim()
    if (/[+\-*/=^_<>~]/.test(trimmed)) return whole
    return trimmed
  })
  return flat.split(DOLLAR_SENTINEL).join('$')
}

/**
 * Parses tabular inner content into a QuestionTableBlock.
 * Returns null if parsing fails.
 */
export function parseTabular(innerContent: string): QuestionTableBlock | null {
  // Strip column spec like {|c|c|c|} that follows \begin{tabular}
  const stripped = innerContent.replace(/^\s*\{[|clrp{}.\d\\]*\}\s*/, '')
  // Remove \hline commands and split into rows by \\
  const cleaned = stripped.replace(/\\hline/g, '').trim()

  // Split rows on \\ (LaTeX row separator)
  const rawRows = cleaned.split(/\\\\/).filter((r) => r.trim())

  if (rawRows.length < 2) return null // Need at least header + 1 data row

  const rows: string[][] = rawRows.map((row) => row.split('&').map((cell) => cleanCell(cell)))

  // First row is headers, rest is data
  const headers = rows[0]
  const dataRows = rows.slice(1)

  if (headers.length === 0) return null

  return makeTableBlock('', headers, dataRows)
}

/**
 * Detects if an environment is a tabular.
 */
export function isTabularEnv(envName: string): boolean {
  return envName === 'tabular' || envName === 'tabular*'
}
