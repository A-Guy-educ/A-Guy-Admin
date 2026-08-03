'use client'

import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { InlineBlockRenderer } from '../LessonBlocksField/InlineBlockRenderer'

interface StudioSectionEditorProps {
  sectionId: string
  title: string | null
  blocks: ContentBlock[]
  dirty: boolean
  onBlockChange: (sectionId: string, index: number, updated: ContentBlock) => void
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
}) => {
  return (
    <div className="studio-section">
      <div className="studio-section-header">
        <div className="studio-section-title">{title || 'Untitled Section'}</div>
        {dirty && <span className="studio-dirty-dot" title="Unsaved changes" />}
      </div>

      {blocks.length === 0 ? (
        <div className="studio-empty">No content blocks in this section.</div>
      ) : (
        <div className="studio-section-blocks">
          {blocks.map((block, index) => (
            <div key={block.id || `block-${index}`} className="studio-block-item">
              <InlineBlockRenderer
                block={block}
                onChange={(updated) => onBlockChange(sectionId, index, updated)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
