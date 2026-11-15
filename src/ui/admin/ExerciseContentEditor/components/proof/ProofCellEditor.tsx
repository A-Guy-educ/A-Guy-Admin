'use client'

import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ProofTable } from '@/server/payload/collections/Exercises/types'
import {
  PROOF_MAX_OPTIONS,
  PROOF_MIN_OPTIONS,
  addOption,
  cellKey,
  correctOptionIndex,
  isBlankCell,
  removeOption,
  setCellBlank,
  setCellText,
  setCorrectOption,
  setOptionText,
} from '../../editors/proofTable'

interface ProofCellEditorProps {
  table: ProofTable
  rowIdx: number
  colIdx: number
  onChange: (table: ProofTable) => void
}

/** One claim/reason cell: fixed text, or 2–3 options the student picks from. */
export const ProofCellEditor: React.FC<ProofCellEditorProps> = ({
  table,
  rowIdx,
  colIdx,
  onChange,
}) => {
  const key = cellKey(rowIdx, colIdx)
  const blank = isBlankCell(table, rowIdx, colIdx)
  const options = table.options[key] ?? []
  const correctIdx = correctOptionIndex(table, key)

  return (
    <div className={`table-cell-wrapper${blank ? ' table-cell-wrapper--fillable' : ''}`}>
      <label className="table-config-option">
        <input
          type="checkbox"
          checked={blank}
          onChange={(e) => onChange(setCellBlank(table, rowIdx, colIdx, e.target.checked))}
        />
        <span>Student picks</span>
      </label>

      {!blank && (
        <input
          type="text"
          className="table-cell-input"
          value={table.rowsData[rowIdx]?.[colIdx] ?? ''}
          onChange={(e) => onChange(setCellText(table, rowIdx, colIdx, e.target.value))}
          placeholder={colIdx === 0 ? '$KL = XY$' : 'נתון'}
        />
      )}

      {blank && (
        <div className="mcq-options-list">
          {options.map((option, optionIdx) => (
            <div key={optionIdx} className="mcq-option-row">
              <div className="mcq-option-correct">
                <button
                  type="button"
                  className={`mcq-correct-marker ${correctIdx === optionIdx ? 'mcq-correct-marker--checked' : ''}`}
                  onClick={() => onChange(setCorrectOption(table, key, optionIdx))}
                  title="Mark as the correct option"
                >
                  <div className="mcq-correct-inner" />
                </button>
              </div>
              <div className="mcq-option-content">
                <input
                  type="text"
                  className="accepted-answer-input"
                  aria-label={`Option ${optionIdx + 1}`}
                  value={option}
                  onChange={(e) => onChange(setOptionText(table, key, optionIdx, e.target.value))}
                />
              </div>
              <div className="mcq-option-actions">
                <button
                  type="button"
                  className="mcq-option-action-btn mcq-option-action-btn--delete"
                  onClick={() => onChange(removeOption(table, key, optionIdx))}
                  disabled={options.length <= PROOF_MIN_OPTIONS}
                  title="Delete option"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {options.length < PROOF_MAX_OPTIONS && (
            <button
              type="button"
              className="mcq-add-option-btn"
              onClick={() => onChange(addOption(table, key))}
            >
              <Plus size={14} /> Add option
            </button>
          )}
        </div>
      )}
    </div>
  )
}
