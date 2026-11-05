'use client'

import { FileCode } from 'lucide-react'
import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { AddBlockButton } from './AddBlockButton'
import { LazyInlineBlockEditor, prefetchInlineBlockEditor } from './LazyInlineBlockEditor'
import { StudioBlocksJsonModal } from './StudioBlocksJsonModal'
import { StudioDocBlock } from './StudioDocBlock'
import type { StudioViewMode } from './viewMode'

interface StudioLessonBlocksProps {
  blocks: ContentBlock[]
  dirty: boolean
  onBlockChange: (index: number, updated: ContentBlock) => void
  onAddBlock: (block: ContentBlock, insertAt?: number) => void
  onDeleteBlock: (index: number) => void
  onReplaceBlocks: (blocks: ContentBlock[]) => void
  viewMode: StudioViewMode
}

/**
 * The lesson's own `content.blocks`, rendered as a card above the exercises.
 * Lesson blocks always sit at the top of the lesson — they can't be
 * interleaved with exercises — so this is a single fixed slot rather than a
 * playlist entry. Purely controlled; the parent owns state and saving.
 */
export const StudioLessonBlocks: React.FC<StudioLessonBlocksProps> = ({
  blocks,
  dirty,
  onBlockChange,
  onAddBlock,
  onDeleteBlock,
  onReplaceBlocks,
  viewMode,
}) => {
  const [showBlocksJson, setShowBlocksJson] = React.useState(false)
  const hasBlocks = blocks.length > 0
  // Same guard as sections/exercises: ContentSchema requires blocks.length >= 1
  // once the field is set, so the last block can't be removed.
  const canDeleteBlock = blocks.length > 1

  React.useEffect(() => {
    if (viewMode === 'edit' && hasBlocks) prefetchInlineBlockEditor()
  }, [viewMode, hasBlocks])

  return (
    <section className="studio-exercise-card studio-lesson-blocks">
      <header className="studio-exercise-header">
        <h2 className="studio-exercise-title">
          Lesson blocks
          {dirty && <span className="studio-dirty-dot" title="Unsaved changes" />}
        </h2>
        {hasBlocks && (
          <div className="studio-row-toolbar">
            <button
              type="button"
              className="studio-row-btn"
              onClick={() => setShowBlocksJson(true)}
              title="View / edit JSON for all lesson-level blocks"
            >
              <FileCode size={12} /> JSON
            </button>
          </div>
        )}
      </header>

      <div className="studio-exercise-body">
        <div className="studio-section-blocks">
          {blocks.map((block, index) => {
            const handleChange = (updated: ContentBlock) => onBlockChange(index, updated)
            const handleDelete = canDeleteBlock ? () => onDeleteBlock(index) : undefined
            return (
              <React.Fragment key={block.id || `block-${index}`}>
                <div className="studio-add-block-row studio-add-block-row--between">
                  <AddBlockButton onAdd={(newBlock) => onAddBlock(newBlock, index)} />
                </div>
                <div className="studio-block-item">
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
              </React.Fragment>
            )
          })}
          <div className="studio-add-block-row">
            <AddBlockButton onAdd={(block) => onAddBlock(block)} />
          </div>
        </div>
      </div>
      {showBlocksJson && (
        <StudioBlocksJsonModal
          blocks={blocks}
          label="Lesson blocks"
          onApply={onReplaceBlocks}
          onClose={() => setShowBlocksJson(false)}
        />
      )}
    </section>
  )
}
