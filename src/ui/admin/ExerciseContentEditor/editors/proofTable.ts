/**
 * Immutable updates for a question_proof table. Blank cells hold their choices
 * in `options[key]` and the correct choice's text in `answers[key]`.
 */

import type { ProofTable } from '@/server/payload/collections/Exercises/types'

export const PROOF_MIN_OPTIONS = 2
export const PROOF_MAX_OPTIONS = 3

export const cellKey = (rowIdx: number, colIdx: number): string => `${rowIdx}-${colIdx}`

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _omit, ...rest } = record
  return rest
}

function setCell(table: ProofTable, rowIdx: number, colIdx: number, value: string): ProofTable {
  return {
    ...table,
    rowsData: table.rowsData.map((row, ri) =>
      ri === rowIdx ? row.map((cell, ci) => (ci === colIdx ? value : cell)) : row,
    ),
  }
}

export function isBlankCell(table: ProofTable, rowIdx: number, colIdx: number): boolean {
  return cellKey(rowIdx, colIdx) in table.options
}

export function setCellText(
  table: ProofTable,
  rowIdx: number,
  colIdx: number,
  text: string,
): ProofTable {
  return setCell(table, rowIdx, colIdx, text)
}

/** Turn a cell into a dropdown (keeping its text as the first, correct option) or back. */
export function setCellBlank(
  table: ProofTable,
  rowIdx: number,
  colIdx: number,
  blank: boolean,
): ProofTable {
  const key = cellKey(rowIdx, colIdx)
  if (blank) {
    const text = table.rowsData[rowIdx]?.[colIdx] ?? ''
    return {
      ...setCell(table, rowIdx, colIdx, ''),
      options: { ...table.options, [key]: [text, ''] },
      answers: { ...table.answers, [key]: text },
    }
  }
  return {
    ...setCell(table, rowIdx, colIdx, table.answers[key] ?? ''),
    options: omitKey(table.options, key),
    answers: omitKey(table.answers, key),
  }
}

export function correctOptionIndex(table: ProofTable, key: string): number {
  return Math.max(0, (table.options[key] ?? []).indexOf(table.answers[key] ?? ''))
}

export function setOptionText(
  table: ProofTable,
  key: string,
  optionIdx: number,
  text: string,
): ProofTable {
  const options = table.options[key] ?? []
  const isCorrect = correctOptionIndex(table, key) === optionIdx
  return {
    ...table,
    options: { ...table.options, [key]: options.map((o, i) => (i === optionIdx ? text : o)) },
    answers: isCorrect ? { ...table.answers, [key]: text } : table.answers,
  }
}

export function setCorrectOption(table: ProofTable, key: string, optionIdx: number): ProofTable {
  const option = table.options[key]?.[optionIdx]
  if (option === undefined) return table
  return { ...table, answers: { ...table.answers, [key]: option } }
}

export function addOption(table: ProofTable, key: string): ProofTable {
  const options = table.options[key] ?? []
  if (options.length >= PROOF_MAX_OPTIONS) return table
  return { ...table, options: { ...table.options, [key]: [...options, ''] } }
}

export function removeOption(table: ProofTable, key: string, optionIdx: number): ProofTable {
  const options = table.options[key] ?? []
  if (options.length <= PROOF_MIN_OPTIONS) return table
  const wasCorrect = correctOptionIndex(table, key) === optionIdx
  const nextOptions = options.filter((_, i) => i !== optionIdx)
  return {
    ...table,
    options: { ...table.options, [key]: nextOptions },
    answers: wasCorrect ? { ...table.answers, [key]: nextOptions[0] } : table.answers,
  }
}

export function addRow(table: ProofTable): ProofTable {
  return { ...table, rowsData: [...table.rowsData, ['', '']] }
}

/** Remove a row and shift the "row-col" keys of every row below it up by one. */
export function removeRow(table: ProofTable, rowIdx: number): ProofTable {
  if (table.rowsData.length <= 1) return table
  const shiftKeys = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(
      Object.entries(record).flatMap(([key, value]) => {
        const [r, c] = key.split('-').map(Number)
        if (r === rowIdx) return []
        return [[cellKey(r > rowIdx ? r - 1 : r, c), value]]
      }),
    )
  return {
    ...table,
    rowsData: table.rowsData.filter((_, ri) => ri !== rowIdx),
    options: shiftKeys(table.options),
    answers: shiftKeys(table.answers),
  }
}
