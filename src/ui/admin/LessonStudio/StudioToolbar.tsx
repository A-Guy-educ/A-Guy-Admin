'use client'

import React from 'react'
import type { SaveError } from './useStudioSave'

interface StudioToolbarProps {
  lessonTitle: string
  lessonId: string
  dirtyCount: number
  saving: boolean
  errors: SaveError[]
  onSave: () => void
}

export const StudioToolbar: React.FC<StudioToolbarProps> = ({
  lessonTitle,
  lessonId,
  dirtyCount,
  saving,
  errors,
  onSave,
}) => {
  const disabled = saving || dirtyCount === 0

  return (
    <div className="studio-toolbar">
      <div className="studio-toolbar-left">
        <a
          href={`/admin/collections/lessons/${lessonId}`}
          className="studio-toolbar-back"
          title="Back to lesson doc"
        >
          ← Lesson
        </a>
        <div className="studio-toolbar-title">
          <span className="studio-toolbar-eyebrow">Lesson Studio</span>
          <span className="studio-toolbar-lesson">{lessonTitle}</span>
        </div>
      </div>

      <div className="studio-toolbar-right">
        {errors.length > 0 && (
          <span className="studio-toolbar-errors" title={errors.map((e) => e.message).join('\n')}>
            {errors.length} save error{errors.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="studio-toolbar-status">
          {saving
            ? 'Saving…'
            : dirtyCount === 0
              ? 'All changes saved'
              : `${dirtyCount} unsaved section${dirtyCount === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className="studio-toolbar-save"
          onClick={onSave}
          disabled={disabled}
        >
          {saving ? 'Saving…' : `Save all${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
        </button>
      </div>
    </div>
  )
}
