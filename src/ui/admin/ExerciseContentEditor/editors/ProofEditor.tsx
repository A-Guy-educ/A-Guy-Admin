'use client'

import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type {
  InlineRichText,
  ProofTable,
  QuestionProofBlock,
} from '@/server/payload/collections/Exercises/types'
import { ProofCellEditor } from '../components/proof/ProofCellEditor'
import { AttachmentEditor } from './AttachmentEditor'
import { InlineRichTextEditor } from './InlineRichTextEditor'
import { HintSolutionPanel } from './HintSolutionPanel'
import { NotebookToggle } from './NotebookToggle'
import { addRow, removeRow } from './proofTable'

interface ProofEditorProps {
  block: QuestionProofBlock
  onChange: (block: QuestionProofBlock) => void
}

const emptyGiven = (): InlineRichText => ({
  type: 'rich_text',
  format: 'md-math-v1',
  value: '',
  mediaIds: [],
})

export const ProofEditor: React.FC<ProofEditorProps> = ({ block, onChange }) => {
  const { table } = block
  const setTable = (next: ProofTable) => onChange({ ...block, table: next })

  return (
    <div className="table-editor">
      <div className="question-editor-section">
        <label className="question-editor-label">Prompt</label>
        <InlineRichTextEditor
          value={block.prompt}
          onChange={(prompt) => onChange({ ...block, prompt })}
          placeholder="הוכיחו כי..."
        />
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Given (optional)</label>
        <InlineRichTextEditor
          value={block.given ?? emptyGiven()}
          onChange={(given) => onChange({ ...block, given })}
          placeholder="$KL = XY$, $LM = YZ$"
        />
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Headers</label>
        <div className="table-headers-editor">
          {table.headers.map((header, index) => (
            <div key={index} className="table-header-row">
              <input
                type="text"
                className="table-header-input"
                value={header}
                onChange={(e) =>
                  setTable({
                    ...table,
                    headers: table.headers.map((h, i) => (i === index ? e.target.value : h)),
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Proof rows</label>
        <div className="table-rows-container">
          {table.rowsData.map((row, rowIdx) => (
            <div key={rowIdx} className="table-row">
              <div className="table-row-label">Row {rowIdx + 1}</div>
              <div className="table-row-cells">
                {row.map((_, colIdx) => (
                  <ProofCellEditor
                    key={colIdx}
                    table={table}
                    rowIdx={rowIdx}
                    colIdx={colIdx}
                    onChange={setTable}
                  />
                ))}
              </div>
              <button
                type="button"
                className="table-row-remove-btn"
                onClick={() => setTable(removeRow(table, rowIdx))}
                disabled={table.rowsData.length <= 1}
                title="Remove row"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="table-add-row-btn" onClick={() => setTable(addRow(table))}>
          <Plus size={14} />
          <span>Add Row</span>
        </button>
      </div>

      <div className="question-editor-section">
        <AttachmentEditor
          blockId={block.id}
          attachment={block.attachment}
          onChange={(attachment) => {
            if (attachment === undefined) {
              const { attachment: _omit, ...rest } = block
              onChange(rest as QuestionProofBlock)
            } else {
              onChange({ ...block, attachment })
            }
          }}
        />
      </div>

      <div className="question-editor-section">
        <NotebookToggle
          value={block.showNotebook ?? false}
          onChange={(value) => onChange({ ...block, showNotebook: value })}
        />
      </div>

      <div className="question-editor-section">
        <HintSolutionPanel
          hint={block.hint}
          solution={block.solution}
          fullSolution={block.fullSolution}
          blockId={block.id}
          onChange={(field, value) => onChange({ ...block, [field]: value })}
          onBatchChange={(fields) => onChange({ ...block, ...fields })}
        />
      </div>
    </div>
  )
}
