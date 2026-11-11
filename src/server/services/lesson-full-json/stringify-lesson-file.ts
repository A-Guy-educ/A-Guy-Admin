/**
 * Pretty-print the full lesson JSON for LLM editing: any value that fits on
 * one line (a point, an option, a short answer) stays on one line; larger
 * values break into indented children. Output is plain, valid JSON.
 */
const MAX_LINE_WIDTH = 100
const INDENT = '  '

function format(value: unknown, depth: number): string {
  const oneLine = JSON.stringify(value)
  const pad = INDENT.repeat(depth)
  if (oneLine === undefined || pad.length + oneLine.length <= MAX_LINE_WIDTH) return oneLine
  const childPad = INDENT.repeat(depth + 1)
  if (Array.isArray(value)) {
    if (value.length === 0) return oneLine
    const items = value.map((item) => childPad + format(item ?? null, depth + 1))
    return `[\n${items.join(',\n')}\n${pad}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return oneLine
    const lines = entries.map(
      ([key, v]) => `${childPad}${JSON.stringify(key)}: ${format(v, depth + 1)}`,
    )
    return `{\n${lines.join(',\n')}\n${pad}}`
  }
  return oneLine
}

export function stringifyLessonFile(value: unknown): string {
  return format(value, 0)
}
