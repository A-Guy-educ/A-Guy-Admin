/**
 * Splits a v2 `* טקסט:` field into text and markdown pipe tables, in source
 * order, so the converter can emit each table as a `question_table` block
 * between the surrounding text blocks:
 *
 *   | כביש | אורך הדרך |
 *   |---|---|
 *   | 1 | 30 ק״מ |
 */

export type PipeTableSegment =
  | { kind: 'text'; value: string }
  | { kind: 'table'; headers: string[]; rowsData: string[][] }

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

/** Rows are padded / trimmed to the header width — the table schema requires equal widths. */
function parseTable(rows: string[]): PipeTableSegment {
  const [headerLine, ...bodyLines] = rows
  const headers = splitRow(headerLine)
  const rowsData = bodyLines.map((line) => {
    const cells = splitRow(line)
    return headers.map((_, i) => cells[i] ?? '')
  })
  return { kind: 'table', headers, rowsData }
}

export function splitPipeTables(text: string): PipeTableSegment[] {
  const lines = text.split('\n')
  const segments: PipeTableSegment[] = []
  let textLines: string[] = []

  const flushText = () => {
    const value = textLines.join('\n').trim()
    if (value) segments.push({ kind: 'text', value })
    textLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const isTableStart = TABLE_ROW_RE.test(lines[i]) && DELIMITER_ROW_RE.test(lines[i + 1] ?? '')
    if (!isTableStart) {
      textLines.push(lines[i])
      continue
    }
    const rows = [lines[i]]
    let next = i + 2
    while (next < lines.length && TABLE_ROW_RE.test(lines[next])) {
      rows.push(lines[next])
      next++
    }
    // A table needs at least one data row — a bare header stays text.
    if (rows.length < 2) {
      textLines.push(lines[i], lines[i + 1])
      i++
      continue
    }
    flushText()
    segments.push(parseTable(rows))
    i = next - 1
  }
  flushText()
  return segments
}
