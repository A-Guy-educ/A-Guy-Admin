'use client'

import React from 'react'
import type { SaveError } from './useStudioSave'
import type { StudioViewMode } from './viewMode'

interface StudioToolbarProps {
  lessonTitle: string
  lessonId: string
  dirtyCount: number
  saving: boolean
  errors: SaveError[]
  onSave: () => void
  viewMode: StudioViewMode
  onViewModeChange: (mode: StudioViewMode) => void
}

export const StudioToolbar: React.FC<StudioToolbarProps> = ({
  lessonTitle,
  lessonId,
  dirtyCount,
  saving,
  errors,
  onSave,
  viewMode,
  onViewModeChange,
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
        <div className="studio-view-toggle" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'edit'}
            className={`studio-view-toggle-btn${viewMode === 'edit' ? ' studio-view-toggle-btn--active' : ''}`}
            onClick={() => onViewModeChange('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'document'}
            className={`studio-view-toggle-btn${viewMode === 'document' ? ' studio-view-toggle-btn--active' : ''}`}
            onClick={() => onViewModeChange('document')}
          >
            Document
          </button>
        </div>
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
              : `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}
        </span>
        <button type="button" className="editor-save-button" onClick={onSave} disabled={disabled}>
          {saving ? 'Saving…' : `Save all${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
        </button>
      </div>
    </div>
  )
}
