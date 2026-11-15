import React from 'react'
import type { QuestionProofBlock } from '@/server/payload/collections/Exercises/types'
import { AttachmentDocView } from './AttachmentDocView'
import { AttachmentLayout } from './AttachmentLayout'
import { RichTextDocView } from './RichTextDocView'

interface ProofQuestionDocViewProps {
  block: QuestionProofBlock
}

/**
 * Read-only preview of a question_proof: prompt, given, then the claim/reason
 * table. Blank cells list their options with the correct one in bold. Renders
 * the optional `attachment` diagram alongside per `attachment.layout`.
 */
export const ProofQuestionDocView: React.FC<ProofQuestionDocViewProps> = ({ block }) => {
  const { table } = block
  const questionNode = (
    <>
      <div className="studio-doc-question-prompt">
        <RichTextDocView block={block.prompt} placeholder="Untitled proof question" />
      </div>
      {block.given?.value && (
        <div className="studio-doc-question-prompt">
          <RichTextDocView block={block.given} />
        </div>
      )}
      <div className="studio-doc-table-wrap">
        <table className="studio-doc-table studio-doc-table--bordered">
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} style={{ textAlign: 'start' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rowsData.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, colIdx) => {
                  const key = `${rowIdx}-${colIdx}`
                  const options = table.options[key]
                  return (
                    <td key={colIdx} style={{ textAlign: 'start' }}>
                      {options
                        ? options.map((option, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && ' / '}
                              {option === table.answers[key] ? <strong>{option}</strong> : option}
                            </React.Fragment>
                          ))
                        : cell}
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
