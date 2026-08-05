'use client'

import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import type { StudioTreeExercise } from '@/server/payload/endpoints/studio/lesson-tree'
import { StudioSectionEditor } from './StudioSectionEditor'

interface StudioExerciseCardProps {
  index: number
  exercise: StudioTreeExercise
  sectionBlocksById: Record<string, ContentBlock[]>
  dirtySectionIds: Set<string>
  onBlockChange: (sectionId: string, index: number, updated: ContentBlock) => void
}

export const StudioExerciseCard: React.FC<StudioExerciseCardProps> = ({
  index,
  exercise,
  sectionBlocksById,
  dirtySectionIds,
  onBlockChange,
}) => {
  return (
    <section className="studio-exercise-card">
      <header className="studio-exercise-header">
        <h2 className="studio-exercise-title">
          <span className="studio-exercise-number">{index + 1}.</span>{' '}
          {exercise.title || 'Untitled Exercise'}
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

      {exercise.sections.length === 0 ? (
        <div className="studio-empty">This exercise has no sections.</div>
      ) : (
        <div className="studio-exercise-body">
          {exercise.sections.map((section) => (
            <StudioSectionEditor
              key={section.id}
              sectionId={section.id}
              title={section.title}
              blocks={sectionBlocksById[section.id] ?? section.blocks}
              dirty={dirtySectionIds.has(section.id)}
              onBlockChange={onBlockChange}
            />
          ))}
        </div>
      )}
    </section>
  )
}
