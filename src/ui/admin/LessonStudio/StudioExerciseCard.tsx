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

interface StudioExerciseCardProps {
  index: number
  exercise: StudioTreeExercise
  sectionBlocksById: Record<string, ContentBlock[]>
  exerciseBlocksById: Record<string, ContentBlock[]>
  dirtySectionIds: Set<string>
  dirtyExerciseIds: Set<string>
  /**
   * Set of in-flight row operations keyed by `${op}:${id}` (e.g.
   * `"delete-section:abc123"`). Row buttons disable while their own key is
   * present to prevent double-submit — matters especially for
   * `duplicate-exercise` which triggers the expensive prod deep-clone.
   */
  pendingRowOps: Set<string>
  onSectionBlockChange: (sectionId: string, index: number, updated: ContentBlock) => void
  onExerciseBlockChange: (exerciseId: string, index: number, updated: ContentBlock) => void
  onAddSectionBlock: (sectionId: string, block: ContentBlock) => void
  onAddExerciseBlock: (exerciseId: string, block: ContentBlock) => void
  onDeleteSectionBlock: (sectionId: string, index: number) => void
  onDeleteExerciseBlock: (exerciseId: string, index: number) => void
  onAddSection: (exerciseId: string, title: string, insertAfter?: string) => Promise<void>
  onDeleteSection: (sectionId: string, sectionTitle: string) => Promise<void>
  onDeleteExercise: (exerciseId: string, exerciseTitle: string) => Promise<void>
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
  const exerciseDeleting = pendingRowOps.has(`delete-exercise:${exercise.id}`)
  const exerciseDuplicating = pendingRowOps.has(`duplicate-exercise:${exercise.id}`)

  React.useEffect(() => {
    if (viewMode === 'edit' && hasExerciseBlocks) prefetchInlineBlockEditor()
  }, [viewMode, hasExerciseBlocks])

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
            disabled={exerciseDuplicating || exerciseDeleting}
            title="Duplicate exercise (creates a copy right below this one)"
          >
            {exerciseDuplicating ? 'Duplicating…' : 'Duplicate'}
          </button>
          <button
            type="button"
            className="studio-row-btn studio-row-btn--danger"
            onClick={() => onDeleteExercise(exercise.id, exercise.title ?? '')}
            disabled={exerciseDeleting || exerciseDuplicating}
            title="Delete exercise (and all its sections)"
          >
            {exerciseDeleting ? 'Deleting…' : 'Delete'}
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
                const handleDelete = () => onDeleteExerciseBlock(exercise.id, blockIndex)
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
                        <button
                          type="button"
                          className="studio-block-delete-btn"
                          onClick={handleDelete}
                          title="Delete this block"
                          aria-label="Delete block"
                        >
                          ×
                        </button>
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

        {exercise.sections.map((section) => (
          <React.Fragment key={section.id}>
            <StudioSectionEditor
              sectionId={section.id}
              title={section.title}
              blocks={sectionBlocksById[section.id] ?? section.blocks}
              dirty={dirtySectionIds.has(section.id)}
              deleting={pendingRowOps.has(`delete-section:${section.id}`)}
              duplicating={pendingRowOps.has(`duplicate-section:${section.id}`)}
              onBlockChange={onSectionBlockChange}
              onAddBlock={onAddSectionBlock}
              onDeleteBlock={onDeleteSectionBlock}
              onDelete={() => onDeleteSection(section.id, section.title ?? '')}
              onDuplicate={() => onDuplicateSection(section.id)}
              viewMode={viewMode}
            />
            {/* +Add section between this section and the next in the same
                exercise. Passing insertAfter tells the server to place the
                new sectionRef right after the current one in the exercise's
                playlist. */}
            <div className="studio-add-section-row">
              <AddChildButton
                label="Add section"
                placeholder="Section title"
                onSubmit={(title) => onAddSection(exercise.id, title, section.id)}
              />
            </div>
          </React.Fragment>
        ))}
        {exercise.sections.length === 0 && (
          <div className="studio-add-section-row">
            <AddChildButton
              label="Add section"
              placeholder="Section title"
              onSubmit={(title) => onAddSection(exercise.id, title)}
            />
          </div>
        )}
      </div>
    </section>
  )
}
