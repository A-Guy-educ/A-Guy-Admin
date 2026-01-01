'use client'

import React, { useState } from 'react'
import { MessageSquare, BookOpen, PenLine } from 'lucide-react'
import { cn } from '@/utilities/ui'
import { useTranslations } from '@/providers/I18n'
import './index.scss'

type SidebarTab = 'formulas' | 'notes'

interface NotebookWorkspaceProps {
  content: React.ReactNode
  chat: React.ReactNode
  formulas: React.ReactNode
  notes: React.ReactNode
}

export function NotebookWorkspace({ content, chat, formulas, notes }: NotebookWorkspaceProps) {
  const t = useTranslations('courses')
  const [activeTab, setActiveTab] = useState<SidebarTab>('formulas')

  return (
    <div className="notebook-workspace">
      <header className="notebook-workspace__header">
        <div className="notebook-workspace__title-group">
          <h2 className="notebook-workspace__title">{t('notebookTitle')}</h2>
          <span className="notebook-workspace__pdf">PDF</span>
        </div>

        <nav className="notebook-workspace__tabs">
          <button className="notebook-workspace__tab notebook-workspace__tab--static" type="button">
            <MessageSquare className="w-4 h-4" />
            <span>{t('chatTab')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('formulas')}
            className={cn(
              'notebook-workspace__tab',
              activeTab === 'formulas' && 'notebook-workspace__tab--active',
            )}
          >
            <BookOpen className="w-4 h-4" />
            <span>{t('formulasTab')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={cn(
              'notebook-workspace__tab',
              activeTab === 'notes' && 'notebook-workspace__tab--active',
            )}
          >
            <PenLine className="w-4 h-4" />
            <span>{t('notesTab')}</span>
          </button>
        </nav>
      </header>

      <div className="notebook-workspace__body">
        <aside className="notebook-workspace__sidebar">
          <div className="notebook-workspace__chat">{chat}</div>
          <div className="notebook-workspace__tools">
            {activeTab === 'formulas' && formulas}
            {activeTab === 'notes' && notes}
          </div>
        </aside>

        <main className="notebook-workspace__content">
          <div className="notebook-workspace__paper">{content}</div>
        </main>
      </div>
    </div>
  )
}
