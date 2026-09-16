import React from 'react'
import type { QuestionMatchingBlock } from '@/server/payload/collections/Exercises/types'
import { AttachmentDocView } from './AttachmentDocView'
import { AttachmentLayout } from './AttachmentLayout'
import { RichTextDocView } from './RichTextDocView'

interface MatchingQuestionDocViewProps {
  block: QuestionMatchingBlock
}

/**
 * Read-only preview of a question_matching: prompt + a two-column table
 * showing the correct pairs (left item ↔ matched right item). Renders the
 * optional `attachment` sketch alongside per `attachment.layout`.
 */
export const MatchingQuestionDocView: React.FC<MatchingQuestionDocViewProps> = ({ block }) => {
  const rightById = new Map(block.rightColumn.map((r) => [r.id, r]))
  const leftById = new Map(block.leftColumn.map((l) => [l.id, l]))

  const questionNode = (
    <>
      <div className="studio-doc-question-prompt">
        <RichTextDocView block={block.prompt} placeholder="Untitled matching question" />
      </div>
      <ol className="studio-doc-matching">
        {block.correctPairs.map((pair, i) => {
          const left = leftById.get(pair.optionId)
          const right = rightById.get(pair.matchId)
          return (
            <li key={i} className="studio-doc-matching-row">
              <span className="studio-doc-matching-left">
                {left ? (
                  <RichTextDocView block={left.content} />
                ) : (
                  <span className="studio-doc-placeholder">?</span>
                )}
              </span>
              <span className="studio-doc-matching-arrow" aria-hidden="true">
                ↔
              </span>
              <span className="studio-doc-matching-right">
                {right ? (
                  <RichTextDocView block={right.content} />
                ) : (
                  <span className="studio-doc-placeholder">?</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
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
