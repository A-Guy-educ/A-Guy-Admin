import React from 'react'
import type {
  QuestionSelectMcqBlock,
  QuestionSelectTrueFalseBlock,
  QuestionFreeResponseBlock,
} from '@/server/payload/collections/Exercises/types'
import { RichTextDocView } from './RichTextDocView'

interface QuestionDocViewProps {
  block: QuestionSelectMcqBlock | QuestionSelectTrueFalseBlock | QuestionFreeResponseBlock
}

// Hebrew/Arabic/Syriac + presentation forms. If the first strong letter of the
// prompt is in one of these ranges we treat the whole question as RTL so
// markers (A. / B. / …) end up on the right side of each option, matching how
// Word lays out Hebrew paragraphs.
const RTL_CHAR = /[֑-߿יִ-﷽ﹰ-ﻼ]/

function detectQuestionDir(text: string | undefined): 'rtl' | 'ltr' | undefined {
  if (!text) return undefined
  const firstLetter = text.match(/\p{L}/u)?.[0]
  if (!firstLetter) return undefined
  return RTL_CHAR.test(firstLetter) ? 'rtl' : 'ltr'
}

/**
 * Read-only, Word-style preview of a question. Prompt is prose; options render
 * as a static bulleted / lettered list with a marker for the correct answer.
 * There is no answer UI — this is authoring preview, not a runtime.
 */
export const QuestionDocView: React.FC<QuestionDocViewProps> = ({ block }) => {
  const dir = detectQuestionDir(block.prompt?.value)
  return (
    <div className="studio-doc-question" dir={dir}>
      <div className="studio-doc-question-prompt">
        <RichTextDocView block={block.prompt} placeholder="Untitled question" />
      </div>
      {renderBody(block)}
    </div>
  )
}

function renderBody(
  block: QuestionSelectMcqBlock | QuestionSelectTrueFalseBlock | QuestionFreeResponseBlock,
) {
  if (block.type === 'question_free_response') {
    const accepted = block.answer.acceptedAnswers ?? []
    return (
      <div className="studio-doc-answer-line">
        <span className="studio-doc-answer-blank" aria-hidden="true" />
        {accepted.length > 0 && (
          <span className="studio-doc-answer-key">Accepted: {accepted.join(', ')}</span>
        )}
      </div>
    )
  }

  if (block.type === 'question_select' && block.variant === 'true_false') {
    const correct = block.answer.correctOptionId
    return (
      <ol className="studio-doc-options studio-doc-options--tf">
        {(block.options ?? []).map((opt) => (
          <li
            key={opt.id}
            className={`studio-doc-option${opt.id === correct ? ' studio-doc-option--correct' : ''}`}
          >
            <span className="studio-doc-option-marker" aria-hidden="true">
              ○
            </span>
            <span className="studio-doc-option-body">
              <RichTextDocView block={opt.label} placeholder={opt.id} />
            </span>
          </li>
        ))}
      </ol>
    )
  }

  const mcq = block
  const correctSet = new Set(mcq.answer.correctOptionIds ?? [])
  return (
    <ol className="studio-doc-options studio-doc-options--mcq">
      {mcq.answer.options.map((opt, i) => (
        <li
          key={opt.id}
          className={`studio-doc-option${correctSet.has(opt.id) ? ' studio-doc-option--correct' : ''}`}
        >
          <span className="studio-doc-option-marker" aria-hidden="true">
            {String.fromCharCode(65 + i)}.
          </span>
          <span className="studio-doc-option-body">
            <RichTextDocView block={opt.content} placeholder={`Option ${i + 1}`} />
          </span>
        </li>
      ))}
    </ol>
  )
}
