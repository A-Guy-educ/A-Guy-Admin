/**
 * Proof Question Component
 * Renders a claim/reason proof table where blank cells are option dropdowns.
 * Per-cell feedback is managed internally; overall result flows to parent via callback.
 */

'use client'

import React, { useState, useCallback, useMemo } from 'react'
import type { QuestionProofBlock, UserAnswer, RichTextBlock, TableCellResult } from '../../types'
import { RichTextRenderer } from '../../blocks/RichTextRenderer'
import { ProofTable } from './ProofTable'
import { validateTableAnswers } from '../../utils/tableValidation'
import { Button } from '@/ui/shared/components/button'
import { cn } from '@/infra/utils/ui'
import { CheckCircle2 } from 'lucide-react'

interface ProofQuestionProps {
  question: QuestionProofBlock
  answer: UserAnswer
  onChange: (answer: UserAnswer) => void
  checked: boolean
  allCorrect: boolean
  onCheckResult: (isCorrect: boolean) => void
  t: (key: string) => string
}

export function ProofQuestion({
  question,
  answer,
  onChange,
  checked,
  allCorrect,
  onCheckResult,
  t,
}: ProofQuestionProps) {
  const [cellResults, setCellResults] = useState<TableCellResult[]>([])
  const EMPTY_CELLS: Record<string, string> = useMemo(() => ({}), [])
  const cellValues = answer.type === 'table' ? answer.cellValues : EMPTY_CELLS

  const promptBlock: RichTextBlock = {
    ...question.prompt,
    id: `${question.id}-prompt`,
    mediaIds: question.prompt.mediaIds || [],
  }
  const givenBlock: RichTextBlock | null = question.given?.value
    ? {
        ...question.given,
        id: `${question.id}-given`,
        mediaIds: question.given.mediaIds || [],
      }
    : null

  const handleCellChange = useCallback(
    (key: string, value: string) => {
      setCellResults((prev) => prev.filter((r) => r.key !== key))
      onChange({ type: 'table', cellValues: { ...cellValues, [key]: value } })
    },
    [cellValues, onChange],
  )

  const handleCheck = useCallback(() => {
    const { cellResults: results, allCorrect: correct } = validateTableAnswers(
      cellValues,
      question.table.answers,
    )
    setCellResults(results)
    onCheckResult(correct)
  }, [cellValues, question.table.answers, onCheckResult])

  return (
    <div className="flex flex-col gap-content-gap">
      {/* Question container */}
      <div className="rounded-2xl border border-border/40 bg-background/60 dark:bg-card dark:border-border/60 dark:shadow-card p-content-gap">
        <div
          className="w-8 h-1 rounded-full mb-3"
          style={{ backgroundColor: 'hsl(var(--tab-learn))' }}
        />
        <div className="text-body-md font-medium text-foreground leading-relaxed">
          <RichTextRenderer block={promptBlock} />
        </div>
      </div>

      {givenBlock && (
        <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
          <div className="text-body-sm font-bold text-muted-foreground mb-1">{t('proofGiven')}</div>
          <div className="text-body-md text-foreground">
            <RichTextRenderer block={givenBlock} />
          </div>
        </div>
      )}

      <ProofTable
        table={question.table}
        cellValues={cellValues}
        onCellChange={handleCellChange}
        cellResults={cellResults}
        disabled={allCorrect}
        placeholders={[t('proofChooseClaim'), t('proofChooseReason')]}
      />

      <div className="flex justify-end">
        <Button
          onClick={handleCheck}
          disabled={allCorrect}
          size="lg"
          className={cn(
            'rounded-xl font-bold text-body-md',
            allCorrect && 'bg-success hover:bg-success/90 text-white',
          )}
        >
          {allCorrect ? (
            <>
              <CheckCircle2 className="w-5 h-5 mr-2" />
              {t('correct')}
            </>
          ) : checked ? (
            t('tryAgain')
          ) : (
            t('checkAnswer')
          )}
        </Button>
      </div>
    </div>
  )
}
