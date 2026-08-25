'use client'

import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { LazyInlineBlockEditor, prefetchInlineBlockEditor } from './LazyInlineBlockEditor'
import { StudioDocBlock } from './StudioDocBlock'
import type { StudioViewMode } from './viewMode'

interface StudioSectionEditorProps {
  sectionId: string
  title: string | null
  blocks: ContentBlock[]
  dirty: boolean
  onBlockChange: (sectionId: string, index: number, updated: ContentBlock) => void
  viewMode: StudioViewMode
}

/**
 * Renders one section's `content.blocks` as a stack of editable blocks.
 * Purely controlled — parent owns state and dispatches saves.
 */
export const StudioSectionEditor: React.FC<StudioSectionEditorProps> = ({
  sectionId,
  title,
  blocks,
  dirty,
  onBlockChange,
  viewMode,
}) => {
  // In edit mode we mount the editor for every block, so kick off the chunk
  // download as soon as the section renders instead of waiting for interaction.
  React.useEffect(() => {
    if (viewMode === 'edit') prefetchInlineBlockEditor()
  }, [viewMode])

  return (
    <div className="studio-section">
      <header className="studio-section-header">
        <h3 className="studio-section-title">{title || 'Untitled Section'}</h3>
        {dirty && <span className="studio-dirty-dot" title="Unsaved changes" />}
      </header>

      {blocks.length === 0 ? (
        <div className="studio-empty">No content blocks in this section.</div>
      ) : (
        <div className="studio-section-blocks">
          {blocks.map((block, index) => {
            const handleChange = (updated: ContentBlock) => onBlockChange(sectionId, index, updated)
            return (
              <div key={block.id || `block-${index}`} className="studio-block-item">
                {viewMode === 'document' ? (
                  <StudioDocBlock block={block} onChange={handleChange} />
                ) : (
                  <LazyInlineBlockEditor block={block} onChange={handleChange} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
