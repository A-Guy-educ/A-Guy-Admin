/**
 * Rewrites markdown pipe tables in a v2 `* טקסט:` field as one-line `<table>`
 * markup, so splitHtmlSegments turns each into its own html block between the
 * surrounding text:
 *
 *   | כביש | אורך הדרך |
 *   |---|---|
 *   | 1 | 30 ק״מ |
 *
 * A `question_table` can't carry this: Web counts every question_table as
 * answer-required (section letter, walker step), even with no fillable cells,
 * and the exporter skips question blocks at the exercise level.
 */

const DELIMITER_ROW_RE = /^\s*\|\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/

/** Splits a row on its column pipes — `\|` and pipes inside `$…$` math stay in the cell. */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let inMath = false
  const body = line.trim().slice(1, -1)

  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char === '\\' && body[i + 1] === '|' && !inMath) {
      cell += '|'
      i++
    } else if (char === '|' && !inMath) {
      cells.push(cell.trim())
      cell = ''
    } else {
      // `$$` is one delimiter, so only the first `$` of a run toggles.
      if (char === '$' && body[i - 1] !== '$') inMath = !inMath
      cell += char
    }
  }
  return [...cells, cell.trim()]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderRow(cells: string[], width: number, tag: 'th' | 'td'): string {
  const fitted = Array.from({ length: width }, (_, i) => cells[i] ?? '')
  return `<tr>${fitted.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`
}

function renderTable(rows: string[]): string {
  const [headerLine, ...bodyLines] = rows
  const headers = splitRow(headerLine)
  const body = bodyLines.map((line) => renderRow(splitRow(line), headers.length, 'td')).join('')
  return `<table dir="rtl"><thead>${renderRow(headers, headers.length, 'th')}</thead><tbody>${body}</tbody></table>`
}

export function convertPipeTablesToHtml(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const isTableStart = TABLE_ROW_RE.test(lines[i]) && DELIMITER_ROW_RE.test(lines[i + 1] ?? '')
    if (!isTableStart) {
      out.push(lines[i])
      continue
    }
    const rows = [lines[i]]
    let next = i + 2
    while (next < lines.length && TABLE_ROW_RE.test(lines[next])) {
      rows.push(lines[next])
      next++
    }
    out.push(renderTable(rows))
    i = next - 1
  }
  return out.join('\n')
}
