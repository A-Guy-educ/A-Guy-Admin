/**
 * Proof Table - claim/reason table whose blank cells are option dropdowns.
 */

'use client'

import React from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/infra/utils/ui'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shared/components/select'
import type { ProofTable as ProofTableData } from '@/server/payload/collections/Exercises/types'
import type { TableCellResult } from '../../types'

interface ProofTableProps {
  table: ProofTableData
  cellValues: Record<string, string>
  onCellChange: (key: string, value: string) => void
  cellResults: TableCellResult[]
  disabled: boolean
  placeholders: [string, string] // [claim column, reason column]
}

export function ProofTable({
  table,
  cellValues,
  onCellChange,
  cellResults,
  disabled,
  placeholders,
}: ProofTableProps) {
  const resultMap = new Map(cellResults.map((r) => [r.key, r.isCorrect]))

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-border/40 bg-background/60 dark:bg-card dark:shadow-card">
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr>
            {table.headers.map((header, ci) => (
              <th
                key={ci}
                className={cn(
                  'p-3.5 text-start font-bold text-body-sm text-foreground bg-muted/30',
                  'border border-border/30 border-b-2 border-b-border/50',
                  ci === 0 && 'w-[56%]',
                )}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rowsData.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const key = `${ri}-${ci}`
                const options = table.options[key]
                return (
                  <td key={ci} className="p-3.5 text-start align-middle border border-border/30">
                    {cell === '' && options ? (
                      <ProofSelect
                        cellKey={key}
                        options={options}
                        value={cellValues[key] ?? ''}
                        onChange={onCellChange}
                        result={resultMap.get(key)}
                        disabled={disabled || resultMap.get(key) === true}
                        placeholder={placeholders[ci] ?? placeholders[1]}
                      />
                    ) : (
                      <MathMarkdown content={cell} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ProofSelectProps {
  cellKey: string
  options: string[]
  value: string
  onChange: (key: string, value: string) => void
  result: boolean | undefined
  disabled: boolean
  placeholder: string
}

function ProofSelect({
  cellKey,
  options,
  value,
  onChange,
  result,
  disabled,
  placeholder,
}: ProofSelectProps) {
  return (
    <div className="flex items-center gap-content-gap-xs">
      <Select
        value={value || undefined}
        onValueChange={(next) => onChange(cellKey, next)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={placeholder}
          className={cn(
            'min-w-[140px] rounded-lg border-2',
            result === true && 'border-success bg-success/10',
            result === false && 'border-destructive bg-destructive/10',
            result === undefined && 'border-[hsl(var(--tab-learn)/0.4)]',
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              <MathMarkdown content={option} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {result === true && <Check className="w-4 h-4 shrink-0 text-success" />}
      {result === false && <X className="w-4 h-4 shrink-0 text-destructive" />}
    </div>
  )
}
