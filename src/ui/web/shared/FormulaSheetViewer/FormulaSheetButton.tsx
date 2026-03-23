/**
 * FormulaSheetButton
 *
 * @fileType component
 * @domain formula-sheets
 * @pattern action-button
 * @ai-summary Button component to open formula sheet viewer
 */

'use client'

import { useState } from 'react'

import { BookOpen } from 'lucide-react'

import type { FormulaSheet } from '@/payload-types'
import { useMediaQuery } from '@/server/payload/hooks/useMediaQuery'
import { Button } from '@/ui/web/components/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/ui/web/components/sheet'
import { useTranslations } from '@/ui/web/providers/I18n'
import { FormulaSheetContent } from './FormulaSheetContent'

export interface FormulaSheetButtonProps {
  /** The formula sheet data (null = button is hidden) */
  sheet: FormulaSheet | null

  /** Additional className for the button */
  className?: string
}

/**
 * FormulaSheetButton - Opens formula sheet viewer when clicked
 *
 * Only renders if a sheet is provided. Shows a book icon button
 * that opens the sheet content in a sliding panel (desktop) or bottom drawer (mobile).
 */
export function FormulaSheetButton({ sheet, className }: FormulaSheetButtonProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('courses')
  const isDesktop = useMediaQuery('(min-width: 640px)')

  if (!sheet) {
    return null
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        aria-label={t('formulaSheetTitle')}
      >
        <BookOpen className="h-4 w-4 ltr:mr-2 rtl:ml-2" />
        <span className="hidden sm:inline">{t('formulaSheetTitle')}</span>
      </Button>

      <SheetContent
        side={isDesktop ? 'left' : 'bottom'}
        className={
          isDesktop
            ? 'w-full sm:max-w-[600px] md:max-w-[700px] lg:max-w-[800px] overflow-y-auto'
            : 'h-[85vh] overflow-y-auto rounded-t-2xl'
        }
      >
        <SheetHeader className="mb-4">
          <SheetTitle className="text-xl font-semibold">{sheet.title}</SheetTitle>
          <p className="text-sm text-muted-foreground">{t('formulaSheetTitle')}</p>
        </SheetHeader>

        <div className={isDesktop ? 'pr-8' : ''}>
          <FormulaSheetContent sheet={sheet} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
