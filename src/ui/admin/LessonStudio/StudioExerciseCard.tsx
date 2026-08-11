'use client'

import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import type { StudioTreeExercise } from '@/server/payload/endpoints/studio/lesson-tree'
import { InlineBlockRenderer } from '../LessonBlocksField/InlineBlockRenderer'
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
  onSectionBlockChange: (sectionId: string, index: number, updated: ContentBlock) => void
  onExerciseBlockChange: (exerciseId: string, index: number, updated: ContentBlock) => void
  viewMode: StudioViewMode
}

export const StudioExerciseCard: React.FC<StudioExerciseCardProps> = ({
  index,
  exercise,
  sectionBlocksById,
  exerciseBlocksById,
  dirtySectionIds,
  dirtyExerciseIds,
  onSectionBlockChange,
  onExerciseBlockChange,
  viewMode,
}) => {
  const exerciseBlocks = exerciseBlocksById[exercise.id] ?? exercise.blocks
  const hasSections = exercise.sections.length > 0
  const hasExerciseBlocks = exerciseBlocks.length > 0
  const exerciseDirty = dirtyExerciseIds.has(exercise.id)

  return (
    <section className="studio-exercise-card">
      <header className="studio-exercise-header">
        <h2 className="studio-exercise-title">
          <span className="studio-exercise-number">{index + 1}.</span>{' '}
          {exercise.title || 'Untitled Exercise'}
          {exerciseDirty && <span className="studio-dirty-dot" title="Unsaved changes" />}
        </h2>
        <a
          href={`/admin/collections/exercises/${exercise.id}`}
          className="studio-exercise-openlink"
          target="_blank"
          rel="noreferrer"
          title="Open exercise doc in a new tab"
        >
          Open ↗
        </a>
      </header>

      {!hasSections && !hasExerciseBlocks ? (
        <div className="studio-empty">This exercise has no content.</div>
      ) : (
        <div className="studio-exercise-body">
          {hasExerciseBlocks && (
            <div className="studio-section studio-section-exercise-inline">
              <div className="studio-section-blocks">
                {exerciseBlocks.map((block, blockIndex) => {
                  const handleChange = (updated: ContentBlock) =>
                    onExerciseBlockChange(exercise.id, blockIndex, updated)
                  return (
                    <div key={block.id || `block-${blockIndex}`} className="studio-block-item">
                      {viewMode === 'document' ? (
                        <StudioDocBlock block={block} onChange={handleChange} />
                      ) : (
                        <InlineBlockRenderer block={block} onChange={handleChange} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {exercise.sections.map((section) => (
            <StudioSectionEditor
              key={section.id}
              sectionId={section.id}
              title={section.title}
              blocks={sectionBlocksById[section.id] ?? section.blocks}
              dirty={dirtySectionIds.has(section.id)}
              onBlockChange={onSectionBlockChange}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}
    </section>
  )
}
