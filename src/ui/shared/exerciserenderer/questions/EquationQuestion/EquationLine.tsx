import React from 'react'
import { cn } from '@/infra/utils/ui'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'

interface EquationLineProps {
  left: string
  right: string
  className?: string
}

/** One notebook row: left side, `=`, right side. Math stays LTR on Hebrew pages. */
export function EquationLine({ left, right, className }: EquationLineProps) {
  return (
    <div
      dir="ltr"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-content-gap-xs max-w-sm mx-auto text-center text-heading-xl font-normal',
        className,
      )}
    >
      <MathMarkdown content={`$${left}$`} />
      <span className="text-foreground">=</span>
      <MathMarkdown content={`$${right}$`} />
    </div>
  )
}
