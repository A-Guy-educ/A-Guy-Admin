'use client'

import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import type { StudioTreeExercise } from '@/server/payload/endpoints/studio/lesson-tree'
import { AddBlockButton } from './AddBlockButton'
import { AddChildButton } from './AddChildButton'
import { LazyInlineBlockEditor, prefetchInlineBlockEditor } from './LazyInlineBlockEditor'
import { StudioDocBlock } from './StudioDocBlock'
import { StudioSectionEditor } from './StudioSectionEditor'
import type { StudioViewMode } from './viewMode'

/**
 * `pendingRowOps` is a shared map keyed by `${kind}:${id}` (e.g.
 * `section:abc123`, `exercise:def456`). It tracks the in-flight delete /
 * duplicate operation the parent has kicked off for that row, so the row's
 * toolbar buttons can disable themselves and show a busy label. Nulling the
 * value (not deleting the key) means "no op in flight" — parent removes the
 * entry entirely on completion so React can garbage-collect stale rows.
 */
export type RowOp = 'delete' | 'duplicate'

interface StudioExerciseCardProps {
  index: number
  exercise: StudioTreeExercise
  sectionBlocksById: Record<string, ContentBlock[]>
  exerciseBlocksById: Record<string, ContentBlock[]>
  dirtySectionIds: Set<string>
  dirtyExerciseIds: Set<string>
  pendingRowOps: Record<string, RowOp | undefined>
  onSectionBlockChange: (sectionId: string, index: number, updated: ContentBlock) => void
  onExerciseBlockChange: (exerciseId: string, index: number, updated: ContentBlock) => void
  onAddSectionBlock: (sectionId: string, block: ContentBlock) => void
  onAddExerciseBlock: (exerciseId: string, block: ContentBlock) => void
  onDeleteSectionBlock: (sectionId: string, index: number) => void
  onDeleteExerciseBlock: (exerciseId: string, index: number) => void
  onAddSection: (exerciseId: string, title: string, insertAfter?: string) => Promise<void>
  onDeleteSection: (sectionId: string) => Promise<void>
  onDeleteExercise: (exerciseId: string) => Promise<void>
  onDuplicateSection: (sectionId: string) => Promise<void>
  onDuplicateExercise: (exerciseId: string) => Promise<void>
  viewMode: StudioViewMode
}

export const StudioExerciseCard: React.FC<StudioExerciseCardProps> = ({
  index,
  exercise,
  sectionBlocksById,
  exerciseBlocksById,
  dirtySectionIds,
  dirtyExerciseIds,
  pendingRowOps,
  onSectionBlockChange,
  onExerciseBlockChange,
  onAddSectionBlock,
  onAddExerciseBlock,
  onDeleteSectionBlock,
  onDeleteExerciseBlock,
  onAddSection,
  onDeleteSection,
  onDeleteExercise,
  onDuplicateSection,
  onDuplicateExercise,
  viewMode,
}) => {
  const exerciseBlocks = exerciseBlocksById[exercise.id] ?? exercise.blocks
  const hasExerciseBlocks = exerciseBlocks.length > 0
  const exerciseDirty = dirtyExerciseIds.has(exercise.id)
  const exerciseOp = pendingRowOps[`exercise:${exercise.id}`]
  const exerciseBusy = exerciseOp != null
  // Content schema requires blocks.length >= 1 — save-time validation would 400
  // if the last block were deleted. Matches the guard in StudioSectionEditor.
  const canDeleteExerciseBlock = exerciseBlocks.length > 1

  React.useEffect(() => {
    if (viewMode === 'edit' && hasExerciseBlocks) prefetchInlineBlockEditor()
  }, [viewMode, hasExerciseBlocks])

  const handleDeleteExercise = async () => {
    if (!window.confirm('Delete this exercise and all its sections? This can’t be undone.')) {
      return
    }
    await onDeleteExercise(exercise.id)
  }

  return (
    <section className="studio-exercise-card">
      <header className="studio-exercise-header">
        <h2 className="studio-exercise-title">
          <span className="studio-exercise-number">{index + 1}.</span>{' '}
          {exercise.title || 'Untitled Exercise'}
          {exerciseDirty && <span className="studio-dirty-dot" title="Unsaved changes" />}
        </h2>
        <div className="studio-row-toolbar">
          <button
            type="button"
            className="studio-row-btn"
            onClick={() => onDuplicateExercise(exercise.id)}
            disabled={exerciseBusy}
            title="Duplicate exercise (deep-copies content + child sections)"
          >
            {exerciseOp === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
          </button>
          <button
            type="button"
            className="studio-row-btn studio-row-btn--danger"
            onClick={handleDeleteExercise}
            disabled={exerciseBusy}
            title="Delete exercise and all its child sections"
          >
            {exerciseOp === 'delete' ? 'Deleting…' : 'Delete'}
          </button>
          <a
            href={`/admin/collections/exercises/${exercise.id}`}
            className="studio-exercise-openlink"
            target="_blank"
            rel="noreferrer"
            title="Open exercise doc in a new tab"
          >
            Open ↗
          </a>
        </div>
      </header>

      <div className="studio-exercise-body">
        {hasExerciseBlocks && (
          <div className="studio-section studio-section-exercise-inline">
            <div className="studio-section-blocks">
              {exerciseBlocks.map((block, blockIndex) => {
                const handleChange = (updated: ContentBlock) =>
                  onExerciseBlockChange(exercise.id, blockIndex, updated)
                const handleDelete = canDeleteExerciseBlock
                  ? () => onDeleteExerciseBlock(exercise.id, blockIndex)
                  : undefined
                return (
                  <div key={block.id || `block-${blockIndex}`} className="studio-block-item">
                    {viewMode === 'document' ? (
                      <StudioDocBlock
                        block={block}
                        onChange={handleChange}
                        onDelete={handleDelete}
                      />
                    ) : (
                      <div className="studio-edit-block-wrapper">
                        {canDeleteExerciseBlock && (
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
            </div>
          </div>
        )}
        <div className="studio-add-block-row">
          <AddBlockButton onAdd={(block) => onAddExerciseBlock(exercise.id, block)} />
        </div>
        {exercise.sections.length === 0 ? (
          // Empty-exercise fallback — always show an "Add section" affordance so
          // an exercise that has no sections yet (freshly-created, or one whose
          // only section was just deleted) is still growable without falling
          // back to the admin collection UI.
          <div className="studio-add-section-row">
            <AddChildButton
              label="Add section"
              placeholder="Section title"
              onSubmit={(title) => onAddSection(exercise.id, title)}
            />
          </div>
        ) : (
          exercise.sections.map((section) => (
            // Render `+ Add section` after every section so admins can slot a
            // new one between two existing sections (not just at the end).
            // `insertAfter` is threaded to the server so the new sectionRef
            // lands right after the sibling in the parent exercise's playlist.
            <React.Fragment key={section.id}>
              <StudioSectionEditor
                sectionId={section.id}
                title={section.title}
                blocks={sectionBlocksById[section.id] ?? section.blocks}
                dirty={dirtySectionIds.has(section.id)}
                deleting={pendingRowOps[`section:${section.id}`] === 'delete'}
                duplicating={pendingRowOps[`section:${section.id}`] === 'duplicate'}
                onBlockChange={onSectionBlockChange}
                onAddBlock={onAddSectionBlock}
                onDeleteBlock={onDeleteSectionBlock}
                onDelete={async () => {
                  if (
                    !window.confirm(
                      'Delete this section? Its blocks will be removed. This can’t be undone.',
                    )
                  ) {
                    return
                  }
                  await onDeleteSection(section.id)
                }}
                onDuplicate={() => onDuplicateSection(section.id)}
                viewMode={viewMode}
              />
              <div className="studio-add-section-row">
                <AddChildButton
                  label="Add section"
                  placeholder="Section title"
                  onSubmit={(title) => onAddSection(exercise.id, title, section.id)}
                />
              </div>
            </React.Fragment>
          ))
        )}
      </div>
    </section>
  )
}
