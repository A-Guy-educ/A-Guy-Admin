'use client'

import React, { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/infra/utils/ui'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'
import type { EquationStep, QuestionEquationBlock, RichTextBlock, UserAnswer } from '../../types'
import { RichTextRenderer } from '../../blocks/RichTextRenderer'
import { EquationLine } from './EquationLine'
import { DynamicEquationQuestion } from './DynamicEquationQuestion'

interface EquationQuestionProps {
  question: QuestionEquationBlock
  answer: UserAnswer
  onChange: (answer: UserAnswer) => void
  t: (key: string) => string
}

/**
 * Solve an equation line by line. Each step offers operations applied to both
 * sides; only the step's correct option advances to its authored result.
 * Dynamic mode generates the options instead (see DynamicEquationQuestion).
 */
export function EquationQuestion({ question, answer, onChange, t }: EquationQuestionProps) {
  const [showRetry, setShowRetry] = useState(false)

  const { steps, equation, prompt } = question
  const completedSteps =
    answer.type === 'equation' ? Math.min(answer.completedSteps, steps.length) : 0
  const currentStep: EquationStep | undefined = steps[completedSteps]

  const handleChoice = (step: EquationStep, optionId: string) => {
    if (optionId !== step.correctOptionId) {
      setShowRetry(true)
      return
    }
    setShowRetry(false)
    onChange({ type: 'equation', completedSteps: completedSteps + 1 })
  }

  const handleReset = () => {
    setShowRetry(false)
    onChange({ type: 'equation', completedSteps: 0 })
  }

  const promptBlock: RichTextBlock = {
    ...prompt,
    id: `${question.id}-prompt`,
    mediaIds: prompt.mediaIds || [],
  }

  const promptNode = prompt.value.trim() && (
    <div className="text-body-md font-medium text-foreground leading-relaxed">
      <RichTextRenderer block={promptBlock} />
    </div>
  )

  if (question.mode === 'dynamic' && question.linear) {
    return (
      <DynamicEquationQuestion
        question={question}
        linear={question.linear}
        answer={answer}
        onChange={onChange}
        t={t}
        prompt={promptNode}
      />
    )
  }

  return (
    <div className="flex flex-col gap-content-gap">
      {promptNode}

      <div
        aria-live="polite"
        className="rounded-xl border border-border/40 bg-background/60 dark:bg-card px-2 py-section-sm"
      >
        <EquationLine left={equation.left} right={equation.right} />
        {steps.slice(0, completedSteps).map((step, index) => {
          const chosen = step.options.find((option) => option.id === step.correctOptionId)
          const isFinal = index === steps.length - 1
          return (
            <React.Fragment key={step.id}>
              <EquationLine
                left={chosen?.label ?? ''}
                right={chosen?.label ?? ''}
                className="mt-1 text-destructive font-semibold"
              />
              <div className="max-w-sm mx-auto border-b border-border mt-1 mb-2" />
              <EquationLine
                left={step.result.left}
                right={step.result.right}
                className={cn(isFinal && 'text-success font-bold')}
              />
            </React.Fragment>
          )
        })}
      </div>

      {currentStep ? (
        <>
          <p className="text-center text-body-md font-semibold text-foreground">
            {t('equationPrompt')}
          </p>
          <div dir="ltr" className="grid grid-cols-3 gap-content-gap-xs.5">
            {currentStep.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleChoice(currentStep, option.id)}
                className="min-h-14 rounded-xl border border-border bg-background text-heading-xl font-normal text-foreground hover:border-success/50 hover:bg-success/5 active:scale-[.98] transition-all duration-normal"
              >
                <MathMarkdown content={`$${option.label}$`} />
              </button>
            ))}
          </div>
          <div role="status" className="min-h-5 text-center text-body-sm text-destructive">
            {showRetry && t('equationTryAgain')}
          </div>
        </>
      ) : (
        <p role="status" className="text-center text-body-md font-bold text-success">
          {t('equationSolved')}
        </p>
      )}

      {completedSteps > 0 && (
        <button
          type="button"
          onClick={handleReset}
          className="self-start inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-body-sm text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent hover:border-border/20 transition-all duration-normal"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t('equationReset')}
        </button>
      )}
    </div>
  )
}
