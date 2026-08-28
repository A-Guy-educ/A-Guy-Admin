'use client'

import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { AddBlockButton } from './AddBlockButton'
import { LazyInlineBlockEditor, prefetchInlineBlockEditor } from './LazyInlineBlockEditor'
import { StudioDocBlock } from './StudioDocBlock'
import type { StudioViewMode } from './viewMode'

interface StudioSectionEditorProps {
  sectionId: string
  title: string | null
  blocks: ContentBlock[]
  dirty: boolean
  /** In-flight guards for the row toolbar buttons (delete / duplicate). */
  deleting: boolean
  duplicating: boolean
  onBlockChange: (sectionId: string, index: number, updated: ContentBlock) => void
  onAddBlock: (sectionId: string, block: ContentBlock) => void
  onDeleteBlock: (sectionId: string, index: number) => void
  onDelete: () => Promise<void>
  onDuplicate: () => Promise<void>
  viewMode: StudioViewMode
}

/**
 * Renders one section's `content.blocks` as a stack of editable blocks plus
 * a row toolbar (Duplicate / Delete / Open) in the header. Purely controlled
 * — parent owns state and dispatches saves.
 */
export const StudioSectionEditor: React.FC<StudioSectionEditorProps> = ({
  sectionId,
  title,
  blocks,
  dirty,
  deleting,
  duplicating,
  onBlockChange,
  onAddBlock,
  onDeleteBlock,
  onDelete,
  onDuplicate,
  viewMode,
}) => {
  React.useEffect(() => {
    if (viewMode === 'edit') prefetchInlineBlockEditor()
  }, [viewMode])

  return (
    <div className="studio-section">
      <header className="studio-section-header">
        <h3 className="studio-section-title">{title || 'Untitled Section'}</h3>
        {dirty && <span className="studio-dirty-dot" title="Unsaved changes" />}
        <div className="studio-row-toolbar">
          <button
            type="button"
            className="studio-row-btn"
            onClick={() => onDuplicate()}
            disabled={duplicating || deleting}
            title="Duplicate section (creates a copy right below this one)"
          >
            {duplicating ? 'Duplicating…' : 'Duplicate'}
          </button>
          <button
            type="button"
            className="studio-row-btn studio-row-btn--danger"
            onClick={() => onDelete()}
            disabled={deleting || duplicating}
            title="Delete section"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <a
            href={`/admin/collections/sections/${sectionId}`}
            className="studio-exercise-openlink"
            target="_blank"
            rel="noreferrer"
            title="Open section doc in a new tab"
          >
            Open ↗
          </a>
        </div>
      </header>

      <div className="studio-section-blocks">
        {blocks.map((block, index) => {
          const handleChange = (updated: ContentBlock) => onBlockChange(sectionId, index, updated)
          // Only offer the delete affordance when there's more than one block —
          // ContentSchema requires blocks.length >= 1, so removing the last one
          // would 400 on save and lock the section. State-time guard in the
          // parent's setter catches the two-clicks-in-one-tick race.
          const canDeleteBlock = blocks.length > 1
          const handleDelete = canDeleteBlock ? () => onDeleteBlock(sectionId, index) : undefined
          return (
            <div key={block.id || `block-${index}`} className="studio-block-item">
              {viewMode === 'document' ? (
                <StudioDocBlock block={block} onChange={handleChange} onDelete={handleDelete} />
              ) : (
                <div className="studio-edit-block-wrapper">
                  {canDeleteBlock && (
                    <button
                      type="button"
                      className="studio-block-delete-btn"
                      onClick={handleDelete}
                      title="Delete this block"
                      aria-label="Delete block"
                    >
                      ×
                    </button>
                  )}
                  <LazyInlineBlockEditor block={block} onChange={handleChange} />
                </div>
              )}
            </div>
          )
        })}
        <div className="studio-add-block-row">
          <AddBlockButton onAdd={(block) => onAddBlock(sectionId, block)} />
        </div>
      </div>
    </div>
  )
}
