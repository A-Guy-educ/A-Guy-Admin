'use client'

import React, { useMemo, useState } from 'react'
import { Lightbulb, RotateCcw } from 'lucide-react'
import { cn } from '@/infra/utils/ui'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'
import type { LinearEquation } from '@/server/payload/collections/Exercises/types'
import {
  applyOperation,
  equationLatex,
  fromLinear,
  generateOptions,
  getSolution,
  getUnhelpfulReason,
  isHelpful,
  operationLatex,
  substitutionCheck,
  type EquationOperation,
  type EquationState,
  type Fraction,
  type UnhelpfulReason,
} from '@/server/payload/collections/Exercises/linearEquation'
import type { QuestionEquationBlock, UserAnswer } from '../../types'
import { EquationLine } from './EquationLine'

interface DynamicEquationQuestionProps {
  question: QuestionEquationBlock
  linear: LinearEquation
  answer: UserAnswer
  onChange: (answer: UserAnswer) => void
  t: (key: string) => string
  prompt: React.ReactNode
}

interface PlayedStep {
  operation: EquationOperation
  before: EquationState
  after: EquationState
  helpful: boolean
}

const NOTE_KEYS: Record<UnhelpfulReason, string> = {
  variable: 'equationNoteVariable',
  number: 'equationNoteNumber',
  divide: 'equationNoteDivide',
  clear: 'equationNoteClear',
}

function replay(linear: LinearEquation, operations: readonly EquationOperation[]): PlayedStep[] {
  return operations.reduce<PlayedStep[]>((played, operation) => {
    const before = played.at(-1)?.after ?? fromLinear(linear)
    const after = applyOperation(before, operation)
    return [...played, { operation, before, after, helpful: isHelpful(before, operation) }]
  }, [])
}

/**
 * Dynamic mode: options are generated from the current line after every
 * choice, always mixing helpful and unhelpful operations. Every choice is
 * applied (the equation stays balanced); unhelpful ones get a note. Ends with
 * a substitution check once x stands alone.
 */
export function DynamicEquationQuestion({
  question,
  linear,
  answer,
  onChange,
  t,
  prompt,
}: DynamicEquationQuestionProps) {
  const [attempt, setAttempt] = useState(0)

  const operations = useMemo(
    () => (answer.type === 'equation' ? (answer.operations ?? []) : []),
    [answer],
  )
  const played = useMemo(() => replay(linear, operations), [linear, operations])
  const current = played.at(-1)?.after ?? fromLinear(linear)
  const solution = getSolution(current)
  const options = useMemo(
    () =>
      solution ? [] : generateOptions(current, `${question.id}:${attempt}:${operations.length}`),
    [current, solution, question.id, attempt, operations.length],
  )

  const last = played.at(-1)
  const noteKey =
    last && !last.helpful && NOTE_KEYS[getUnhelpfulReason(last.before, last.operation)]
  const start = equationLatex(fromLinear(linear))

  const choose = (operation: EquationOperation) => {
    const next = [...operations, operation]
    onChange({ type: 'equation', completedSteps: next.length, operations: next })
  }

  const reset = () => {
    setAttempt((n) => n + 1)
    onChange({ type: 'equation', completedSteps: 0, operations: [] })
  }

  return (
    <div className="flex flex-col gap-content-gap">
      {prompt}

      <div
        aria-live="polite"
        className="rounded-xl border border-border/40 bg-background/60 dark:bg-card px-2 py-section-sm"
      >
        <EquationLine left={start.left} right={start.right} />
        {played.map((step, index) => {
          const label = operationLatex(step.operation)
          const line = equationLatex(step.after)
          return (
            <React.Fragment key={index}>
              <EquationLine
                left={label}
                right={label}
                className="mt-1 text-destructive font-semibold"
              />
              <div className="max-w-sm mx-auto border-b border-border mt-1 mb-2" />
              <EquationLine
                left={line.left}
                right={line.right}
                className={cn(
                  step.helpful && 'rounded-lg bg-success/10 text-success font-semibold',
                )}
              />
            </React.Fragment>
          )
        })}
      </div>

      {noteKey && !solution && (
        <div
          role="status"
          className="flex items-start gap-content-gap-xs rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm text-foreground"
        >
          <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <span>{t(noteKey)}</span>
        </div>
      )}

      {solution ? (
        <SolvedPanel linear={linear} solution={solution} t={t} />
      ) : (
        <>
          <p className="text-center text-body-md font-semibold text-foreground">
            {t('equationPrompt')}
          </p>
          <div dir="ltr" className="grid grid-cols-3 gap-content-gap-xs.5">
            {options.map((operation) => {
              const label = operationLatex(operation)
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => choose(operation)}
                  className="min-h-14 rounded-xl border border-border bg-background text-heading-xl font-normal text-foreground hover:border-success/50 hover:bg-success/5 active:scale-[.98] transition-all duration-normal"
                >
                  <MathMarkdown content={`$${label}$`} />
                </button>
              )
            })}
          </div>
        </>
      )}

      {played.length > 0 && (
        <button
          type="button"
          onClick={reset}
          className="self-start inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-body-sm text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent hover:border-border/20 transition-all duration-normal"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t('equationReset')}
        </button>
      )}
    </div>
  )
}

interface SolvedPanelProps {
  linear: LinearEquation
  solution: Fraction
  t: (key: string) => string
}

/** Solved message plus substituting x back into the original equation. */
function SolvedPanel({ linear, solution, t }: SolvedPanelProps) {
  const start = equationLatex(fromLinear(linear))
  const check = substitutionCheck(linear, solution)
  return (
    <div className="flex flex-col gap-content-gap-xs">
      <p role="status" className="text-center text-body-md font-bold text-success">
        {t('equationSolved')}
      </p>
      <p className="text-body-sm font-semibold text-foreground">{t('equationCheckTitle')}</p>
      <div className="flex flex-col gap-1 rounded-xl border border-border/40 bg-background/60 dark:bg-card px-2 py-section-sm">
        <EquationLine left={start.left} right={start.right} />
        <EquationLine left={check.substituted.left} right={check.substituted.right} />
        <EquationLine
          left={check.evaluated.left}
          right={check.evaluated.right}
          className="text-success font-bold"
        />
      </div>
      {check.holds && (
        <p className="text-center text-body-sm font-bold text-success">{t('equationCheckHolds')}</p>
      )}
    </div>
  )
}
