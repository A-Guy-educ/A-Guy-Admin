'use client'

import React from 'react'
import { Lightbulb, CheckCircle, BookOpen } from 'lucide-react'
import { useTranslations } from '@/providers/I18n'
import './index.scss'

export function NotebookChat() {
  const t = useTranslations('courses')

  return (
    <div className="notebook-chat">
      <div className="notebook-chat__messages">
        <div className="notebook-chat__bubble">{t('chatWelcome')}</div>
      </div>

      <div className="notebook-chat__actions">
        <button className="notebook-chat__action">
          <Lightbulb className="w-6 h-6 text-yellow-400" />
          <span>{t('chatHint')}</span>
        </button>
        <button className="notebook-chat__action">
          <CheckCircle className="w-6 h-6 text-green-500" />
          <span>{t('chatSolution')}</span>
        </button>
        <button className="notebook-chat__action">
          <BookOpen className="w-6 h-6 text-blue-500" />
          <span>{t('chatFullSolution')}</span>
        </button>
      </div>

      <div className="notebook-chat__footer">
        <input
          type="text"
          className="notebook-chat__input"
          placeholder={t('chatInputPlaceholder')}
          disabled
        />
        <button className="notebook-chat__send" disabled>
          {t('chatSend')}
        </button>
      </div>
    </div>
  )
}
