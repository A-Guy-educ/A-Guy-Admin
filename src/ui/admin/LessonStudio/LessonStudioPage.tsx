'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

import { StudioExerciseCard } from './StudioExerciseCard'
import { StudioToolbar } from './StudioToolbar'
import { useStudioSave } from './useStudioSave'
import { useStudioTree } from './useStudioTree'
import '../LessonBlocksField/inline-exercise-editor.css'
import '../ExerciseContentEditor/index.css'
import './lesson-studio.css'

interface LessonStudioPageProps {
  lessonId: string
}

/**
 * Lesson Studio — a single scrollable page that unfolds a lesson and lets
 * admins edit every section's content blocks in place. Loads the full tree
 * (lesson + exercises + sections) in one server round-trip and saves dirty
 * sections in one bounded-concurrency batch when the admin clicks "Save all".
 */
export const LessonStudioPage: React.FC<LessonStudioPageProps> = ({ lessonId }) => {
  const { tree, loading, error } = useStudioTree(lessonId)
  const { saving, errors, saveAll } = useStudioSave()

  // Section blocks live in a flat map keyed by section id. Seed from tree
  // once loaded; edits mutate only the changed section's entry.
  const [sectionBlocks, setSectionBlocks] = useState<Record<string, ContentBlock[]>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())

  // Ref mirror of sectionBlocks so the save-completion handler can compare the
  // *current* in-memory blocks against the reference we PATCHed, even if the
  // user edited during the in-flight save.
  const sectionBlocksRef = useRef(sectionBlocks)
  useEffect(() => {
    sectionBlocksRef.current = sectionBlocks
  }, [sectionBlocks])

  useEffect(() => {
    if (!tree) return
    const seeded: Record<string, ContentBlock[]> = {}
    for (const exercise of tree.exercises) {
      for (const section of exercise.sections) {
        // Deep clone so edits don't leak back into the tree response.
        seeded[section.id] = JSON.parse(JSON.stringify(section.blocks))
      }
    }
    setSectionBlocks(seeded)
    setDirtyIds(new Set())
  }, [tree])

  const handleBlockChange = useCallback(
    (sectionId: string, index: number, updated: ContentBlock) => {
      setSectionBlocks((prev) => {
        const current = prev[sectionId]
        if (!current) return prev
        const next = [...current]
        next[index] = updated
        return { ...prev, [sectionId]: next }
      })
      setDirtyIds((prev) => {
        if (prev.has(sectionId)) return prev
        const next = new Set(prev)
        next.add(sectionId)
        return next
      })
    },
    [],
  )

  const dirtyPayload = useMemo(
    () =>
      Array.from(dirtyIds).map((id) => ({
        id,
        blocks: sectionBlocks[id] ?? [],
      })),
    [dirtyIds, sectionBlocks],
  )

  const handleSaveAll = useCallback(async () => {
    if (dirtyPayload.length === 0) return
    const { succeeded } = await saveAll(dirtyPayload)
    if (succeeded.length === 0) return

    // Only clear a section from dirtyIds when its in-memory blocks are still
    // the exact reference we PATCHed. If the user edited during the in-flight
    // save, handleBlockChange replaced sectionBlocks[id] with a new array;
    // clearing dirty in that case would silently discard those newer edits
    // on the next reload.
    const current = sectionBlocksRef.current
    setDirtyIds((prev) => {
      const next = new Set(prev)
      for (const { id, savedBlocks } of succeeded) {
        if (current[id] === savedBlocks) next.delete(id)
      }
      return next
    })
  }, [dirtyPayload, saveAll])

  // Warn before nav-away if there are unsaved changes.
  useEffect(() => {
    if (dirtyIds.size === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtyIds])

  if (loading) return <div className="studio-message">Loading lesson…</div>
  if (error) return <div className="studio-message studio-message-error">{error}</div>
  if (!tree) return <div className="studio-message">Lesson not found.</div>

  return (
    <div className="studio-page">
      <StudioToolbar
        lessonTitle={tree.lesson.title || 'Untitled Lesson'}
        lessonId={tree.lesson.id}
        dirtyCount={dirtyIds.size}
        saving={saving}
        errors={errors}
        onSave={handleSaveAll}
      />

      <main className="studio-content">
        {tree.exercises.length === 0 ? (
          <div className="studio-empty studio-empty-big">This lesson has no exercises yet.</div>
        ) : (
          tree.exercises.map((exercise, index) => (
            <StudioExerciseCard
              key={exercise.id}
              index={index}
              exercise={exercise}
              sectionBlocksById={sectionBlocks}
              dirtySectionIds={dirtyIds}
              onBlockChange={handleBlockChange}
            />
          ))
        )}
      </main>
    </div>
  )
}
