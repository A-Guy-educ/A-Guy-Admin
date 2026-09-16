import React from 'react'
import type { QuestionTableBlock } from '@/server/payload/collections/Exercises/types'
import { AttachmentDocView } from './AttachmentDocView'
import { AttachmentLayout } from './AttachmentLayout'
import { RichTextDocView } from './RichTextDocView'

interface TableQuestionDocViewProps {
  block: QuestionTableBlock
}

/**
 * Read-only preview of a question_table: prompt + a static rendering of the
 * table headers + rows. Answer cells are shown as underscored blanks when
 * solutionFill is on. Renders the optional `attachment` sketch alongside per
 * `attachment.layout`.
 */
export const TableQuestionDocView: React.FC<TableQuestionDocViewProps> = ({ block }) => {
  const table = block.table
  const questionNode = (
    <>
      <div className="studio-doc-question-prompt">
        <RichTextDocView block={block.prompt} placeholder="Untitled table question" />
      </div>
      <div className="studio-doc-table-wrap">
        <table
          className={`studio-doc-table${table.showBorders ? ' studio-doc-table--bordered' : ''}`}
        >
          {table.showHeader && (
            <thead>
              <tr>
                {table.headers.map((h, i) => (
                  <th key={i} style={{ textAlign: table.columnAlignment?.[i] ?? 'left' }}>
                    {h || <span className="studio-doc-placeholder">–</span>}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {table.rowsData.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, colIdx) => {
                  const isFillable = table.solutionFill && cell === ''
                  const align = table.columnAlignment?.[colIdx] ?? 'left'
                  return (
                    <td key={colIdx} style={{ textAlign: align }}>
                      {isFillable ? (
                        <span className="studio-doc-table-blank" aria-hidden="true" />
                      ) : (
                        cell
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )

  if (block.attachment) {
    return (
      <div className="studio-doc-question">
        <AttachmentLayout
          layout={block.attachment.layout}
          question={questionNode}
          attachment={<AttachmentDocView hostBlockId={block.id} attachment={block.attachment} />}
        />
      </div>
    )
  }

  return <div className="studio-doc-question">{questionNode}</div>
}
