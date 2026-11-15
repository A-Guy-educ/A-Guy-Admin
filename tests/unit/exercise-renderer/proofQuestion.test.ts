import { describe, it, expect } from 'vitest'
import { getInitialAnswer } from '@/ui/shared/exerciserenderer/utils/answerChecking'
import { validateTableAnswers } from '@/ui/shared/exerciserenderer/utils/tableValidation'
import { ExerciseBlockDefaults } from '@/server/payload/collections/Exercises/defaults'
import { ContentBlockSchema } from '@/server/payload/collections/Exercises/schemas'
import type { ProofTable, QuestionProofBlock } from '@/server/payload/collections/Exercises/types'
import {
  addOption,
  removeOption,
  removeRow,
  setCellBlank,
  setCorrectOption,
  setOptionText,
} from '@/ui/admin/ExerciseContentEditor/editors/proofTable'

const block: QuestionProofBlock = ExerciseBlockDefaults.question_proof()

const withTable = (table: Partial<ProofTable>): QuestionProofBlock => ({
  ...block,
  table: { ...block.table, ...table },
})

describe('proof schema', () => {
  it('accepts the default block', () => {
    expect(ContentBlockSchema.safeParse(block).success).toBe(true)
  })

  it('rejects an answer that is not one of the options', () => {
    const bad = withTable({ answers: { '3-1': 'משהו אחר' } })
    expect(ContentBlockSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects more than three options', () => {
    const bad = withTable({ options: { '3-1': ['לפי צ–ז–צ', 'a', 'b', 'c'] } })
    expect(ContentBlockSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects options on a cell that has text', () => {
    const bad = withTable({
      options: { ...block.table.options, '0-1': ['נתון', 'x'] },
      answers: { ...block.table.answers, '0-1': 'נתון' },
    })
    expect(ContentBlockSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a proof with no blanks', () => {
    const bad = withTable({ options: {}, answers: {} })
    expect(ContentBlockSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects rows that are not two columns', () => {
    const bad = withTable({ rowsData: [['a', 'b', 'c']] })
    expect(ContentBlockSchema.safeParse(bad).success).toBe(false)
  })
})

describe('proof grading', () => {
  it('starts with an empty table answer', () => {
    expect(getInitialAnswer(block)).toEqual({ type: 'table', cellValues: {} })
  })

  it('is correct when the chosen option matches', () => {
    const result = validateTableAnswers({ '3-1': 'לפי צ–ז–צ' }, block.table.answers)
    expect(result.allCorrect).toBe(true)
  })

  it('is incorrect for a wrong or missing choice', () => {
    expect(validateTableAnswers({ '3-1': 'נתון' }, block.table.answers).allCorrect).toBe(false)
    expect(validateTableAnswers({}, block.table.answers).allCorrect).toBe(false)
  })
})

describe('proof table editing', () => {
  const table = block.table

  it('turns a text cell into a blank whose text is the correct option', () => {
    const next = setCellBlank(table, 0, 1, true)
    expect(next.rowsData[0][1]).toBe('')
    expect(next.options['0-1']).toEqual(['נתון', ''])
    expect(next.answers['0-1']).toBe('נתון')
  })

  it('turns a blank back into its correct text', () => {
    const next = setCellBlank(table, 3, 1, false)
    expect(next.rowsData[3][1]).toBe('לפי צ–ז–צ')
    expect(next.options).toEqual({})
    expect(next.answers).toEqual({})
  })

  it('keeps the answer in sync when the correct option is edited', () => {
    const next = setOptionText(table, '3-1', 0, 'צ–ז–צ')
    expect(next.answers['3-1']).toBe('צ–ז–צ')
    expect(setOptionText(table, '3-1', 2, 'x').answers['3-1']).toBe('לפי צ–ז–צ')
  })

  it('caps options between two and three', () => {
    expect(addOption(table, '3-1')).toBe(table)
    const two = removeOption(table, '3-1', 2)
    expect(two.options['3-1']).toHaveLength(2)
    expect(removeOption(two, '3-1', 0)).toBe(two)
  })

  it('moves the answer when the correct option is removed', () => {
    const next = removeOption(table, '3-1', 0)
    expect(next.answers['3-1']).toBe('לפי ז–צ–ז')
  })

  it('marks another option correct', () => {
    expect(setCorrectOption(table, '3-1', 2).answers['3-1']).toBe('נתון')
  })

  it('shifts keys below a removed row', () => {
    const next = removeRow(table, 0)
    expect(next.rowsData).toHaveLength(3)
    expect(next.options).toEqual({ '2-1': table.options['3-1'] })
    expect(next.answers).toEqual({ '2-1': 'לפי צ–ז–צ' })
  })

  it('drops keys of the removed row', () => {
    const next = removeRow(table, 3)
    expect(next.options).toEqual({})
    expect(next.answers).toEqual({})
  })
})
