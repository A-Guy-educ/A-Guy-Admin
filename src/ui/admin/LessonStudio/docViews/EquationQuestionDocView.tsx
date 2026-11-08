import React from 'react'
import type { QuestionEquationBlock } from '@/server/payload/collections/Exercises/types'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'
import { RichTextDocView } from './RichTextDocView'

interface EquationQuestionDocViewProps {
  block: QuestionEquationBlock
}

/**
 * Read-only preview of a question_equation: prompt, starting equation, then
 * each step's correct option and the line it produces.
 */
export const EquationQuestionDocView: React.FC<EquationQuestionDocViewProps> = ({ block }) => (
  <div className="studio-doc-question">
    {block.prompt.value.trim() && (
      <div className="studio-doc-question-prompt">
        <RichTextDocView block={block.prompt} />
      </div>
    )}
    <div dir="ltr">
      <MathMarkdown content={`$${block.equation.left} = ${block.equation.right}$`} />
    </div>
    <ol className="studio-doc-matching" dir="ltr">
      {block.steps.map((step) => {
        const correct = step.options.find((o) => o.id === step.correctOptionId)
        return (
          <li key={step.id} className="studio-doc-matching-row">
            <span className="studio-doc-matching-left">
              <MathMarkdown content={`$${correct?.label ?? '?'}$`} />
            </span>
            <span className="studio-doc-matching-arrow" aria-hidden="true">
              →
            </span>
            <span className="studio-doc-matching-right">
              <MathMarkdown content={`$${step.result.left} = ${step.result.right}$`} />
            </span>
          </li>
        )
      })}
    </ol>
  </div>
)
