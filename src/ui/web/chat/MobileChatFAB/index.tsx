'use client'

import { useTranslations, useLocale } from '@/ui/web/providers/I18n'
import { cn } from '@/infra/utils/ui'
import { isRTL, type Locale } from '@/i18n/config'
import { MessageSquare, ChevronDown } from 'lucide-react'
import React, { useEffect, useCallback } from 'react'

interface MobileChatFABProps {
  /** Whether the FAB panel is currently open */
  isOpen: boolean
  /** Called when the panel should open */
  onOpen: () => void
  /** Called when the panel should close */
  onClose: () => void
  /** The ChatInterface component to render inside the panel */
  children: React.ReactNode
}

/**
 * Mobile Chat FAB (Floating Action Button) component
 *
 * A bottom-left FAB that opens a bottom-anchored partial panel containing the chat interface.
 * The panel occupies at most 60% of viewport height so the exercise above stays visible.
 *
 * Issue #2192: Add mobile chat FAB (button-to-open) on lesson pages
 */
export function MobileChatFAB({ isOpen, onOpen, onClose, children }: MobileChatFABProps) {
  const t = useTranslations('courses')
  const locale = useLocale()

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Handle focus-chat-input event from exercise flows (wrong-answer help)
  useEffect(() => {
    const handleFocusChatInput = () => {
      onOpen()
    }

    window.addEventListener('focus-chat-input', handleFocusChatInput)
    return () => window.removeEventListener('focus-chat-input', handleFocusChatInput)
  }, [onOpen])

  const handleCollapse = useCallback(() => {
    onClose()
  }, [onClose])

  return (
    <>
      {/* FAB Button - always visible on mobile when panel is closed */}
      {!isOpen && (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            `fixed ${isRTL(locale as Locale) ? 'left-6' : 'right-6'} bottom-6 z-[70]`,
            'w-14 h-14',
            'bg-primary text-primary-foreground rounded-full',
            'shadow-elevation-3 hover:scale-110 hover:bg-primary/90',
            'transition-all duration-normal flex items-center justify-center',
            'md:hidden',
          )}
          aria-label={t('openChat')}
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}

      {/* Bottom Panel */}
      {isOpen && (
        <div
          className={cn(
            'fixed left-0 right-0 bottom-0 z-[60]',
            'bg-card border-t border-border',
            'max-h-[60dvh] overflow-y-auto',
            'flex flex-col',
            'animate-in slide-in-from-bottom-0 duration-300',
            'md:hidden',
          )}
          style={{
            maxHeight: '60dvh',
          }}
          role="dialog"
          aria-modal="false"
          aria-label={t('chatPanelTitle')}
        >
          {/* Collapse handle */}
          <div className="flex items-center justify-center py-2 shrink-0 border-b border-border">
            <button
              type="button"
              onClick={handleCollapse}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2',
                'text-muted-foreground hover:text-foreground',
                'transition-colors duration-normal',
                'rounded-lg hover:bg-muted',
              )}
              aria-label={t('closeChat')}
            >
              <ChevronDown className="w-4 h-4 rotate-180" />
              <span className="text-body-sm">{t('closeChat')}</span>
            </button>
          </div>

          {/* Chat content */}
          <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
        </div>
      )}
    </>
  )
}
