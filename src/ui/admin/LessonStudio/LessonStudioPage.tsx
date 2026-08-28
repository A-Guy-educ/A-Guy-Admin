'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

import { AddChildButton } from './AddChildButton'
import { StudioExerciseCard } from './StudioExerciseCard'
import { StudioToolbar } from './StudioToolbar'
import { createExerciseUnderLesson, createSectionUnderExercise } from './studioCreateApi'
import { useStudioSave, type DirtyEntry } from './useStudioSave'
import { useStudioTree } from './useStudioTree'
import { readStoredViewMode, writeStoredViewMode, type StudioViewMode } from './viewMode'
import { EditorChromeProvider } from '../ExerciseContentEditor/EditorChromeContext'
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
 *
 * Exercise-level content: legacy exercises store blocks directly on
 * `exercise.content.blocks` (no child sections). The tree endpoint surfaces
 * those blocks so they render inline here and save via PATCH /api/exercises/:id
 * alongside section edits.
 */
export const LessonStudioPage: React.FC<LessonStudioPageProps> = ({ lessonId }) => {
  const { tree, loading, error, refetchError, refetch } = useStudioTree(lessonId)
  const { saving, errors, saveAll } = useStudioSave()
  const [viewMode, setViewMode] = useState<StudioViewMode>('document')

  // Rehydrate the admin's last-used view mode after mount. Kept out of the
  // useState initializer so this works under SSR/Next-client-boundary rules
  // where localStorage is only reachable client-side.
  useEffect(() => {
    const stored = readStoredViewMode()
    if (stored) setViewMode(stored)
  }, [])

  const handleViewModeChange = useCallback((next: StudioViewMode) => {
    setViewMode(next)
    writeStoredViewMode(next)
  }, [])

  // Section blocks live in a flat map keyed by section id. Exercise-level
  // content blocks live in a separate map keyed by exercise id (legacy
  // exercises without child sections). Both are seeded from the tree once
  // loaded; edits mutate only the changed entry.
  const [sectionBlocks, setSectionBlocks] = useState<Record<string, ContentBlock[]>>({})
  const [exerciseBlocks, setExerciseBlocks] = useState<Record<string, ContentBlock[]>>({})
  const [dirtySectionIds, setDirtySectionIds] = useState<Set<string>>(new Set())
  const [dirtyExerciseIds, setDirtyExerciseIds] = useState<Set<string>>(new Set())

  // Ref mirrors so the save-completion handler can compare the *current*
  // in-memory blocks against the reference we PATCHed, even if the user edited
  // during the in-flight save.
  const sectionBlocksRef = useRef(sectionBlocks)
  const exerciseBlocksRef = useRef(exerciseBlocks)
  useEffect(() => {
    sectionBlocksRef.current = sectionBlocks
  }, [sectionBlocks])
  useEffect(() => {
    exerciseBlocksRef.current = exerciseBlocks
  }, [exerciseBlocks])

  // Refs mirror dirty sets so the seed effect can read "is this id dirty?"
  // without listing dirty state in its dep array (which would re-seed on
  // every edit — wrong). Refs stay in sync via their own effects below.
  const dirtySectionIdsRef = useRef(dirtySectionIds)
  const dirtyExerciseIdsRef = useRef(dirtyExerciseIds)
  useEffect(() => {
    dirtySectionIdsRef.current = dirtySectionIds
  }, [dirtySectionIds])
  useEffect(() => {
    dirtyExerciseIdsRef.current = dirtyExerciseIds
  }, [dirtyExerciseIds])

  useEffect(() => {
    if (!tree) return
    // Dirty-aware seed. Fires both on initial load AND on `refetch()` after
    // an add-child mutation.
    //   - Non-dirty ids: overwrite from server. This absorbs server-side
    //     normalizations (afterChange hooks, denorm backfills) and any
    //     concurrent updates from another admin session.
    //   - Dirty ids: preserve local state so in-progress edits aren't wiped.
    //     Save-all commits them; then dirty clears via ref-comparison in
    //     handleSaveAll and the next refetch absorbs the server copy.
    //   - Ids we don't have local state for: seed from server (new sections
    //     created via +Add, or first mount).
    const dirtySections = dirtySectionIdsRef.current
    const dirtyExercises = dirtyExerciseIdsRef.current

    const presentSectionIds = new Set<string>()
    const presentExerciseIds = new Set<string>()
    for (const exercise of tree.exercises) {
      presentExerciseIds.add(exercise.id)
      for (const section of exercise.sections) presentSectionIds.add(section.id)
    }

    setSectionBlocks((prev) => {
      const next: Record<string, ContentBlock[]> = {}
      // Evict keys that vanished from the server. Preserve dirty entries even
      // if they've disappeared server-side — save-all will surface a 404 and
      // the admin can decide what to do rather than us silently losing edits.
      for (const [id, blocks] of Object.entries(prev)) {
        if (presentSectionIds.has(id) || dirtySections.has(id)) {
          next[id] = blocks
        }
      }
      for (const exercise of tree.exercises) {
        for (const section of exercise.sections) {
          if (!dirtySections.has(section.id) || !(section.id in next)) {
            next[section.id] = JSON.parse(JSON.stringify(section.blocks))
          }
        }
      }
      return next
    })
    setExerciseBlocks((prev) => {
      const next: Record<string, ContentBlock[]> = {}
      for (const [id, blocks] of Object.entries(prev)) {
        if (presentExerciseIds.has(id) || dirtyExercises.has(id)) {
          next[id] = blocks
        }
      }
      for (const exercise of tree.exercises) {
        if (exercise.blocks.length === 0) continue
        if (!dirtyExercises.has(exercise.id) || !(exercise.id in next)) {
          next[exercise.id] = JSON.parse(JSON.stringify(exercise.blocks))
        }
      }
      return next
    })
  }, [tree])

  const handleSectionBlockChange = useCallback(
    (sectionId: string, index: number, updated: ContentBlock) => {
      setSectionBlocks((prev) => {
        const current = prev[sectionId]
        if (!current) return prev
        const next = [...current]
        next[index] = updated
        return { ...prev, [sectionId]: next }
      })
      setDirtySectionIds((prev) => {
        if (prev.has(sectionId)) return prev
        const next = new Set(prev)
        next.add(sectionId)
        return next
      })
    },
    [],
  )

  const handleExerciseBlockChange = useCallback(
    (exerciseId: string, index: number, updated: ContentBlock) => {
      setExerciseBlocks((prev) => {
        const current = prev[exerciseId]
        if (!current) return prev
        const next = [...current]
        next[index] = updated
        return { ...prev, [exerciseId]: next }
      })
      setDirtyExerciseIds((prev) => {
        if (prev.has(exerciseId)) return prev
        const next = new Set(prev)
        next.add(exerciseId)
        return next
      })
    },
    [],
  )

  const handleAddSectionBlock = useCallback((sectionId: string, block: ContentBlock) => {
    // Seed an empty array first if the section wasn't in the map (edge case
    // for a section that had zero blocks at load time).
    setSectionBlocks((prev) => {
      const current = prev[sectionId] ?? []
      return { ...prev, [sectionId]: [...current, block] }
    })
    setDirtySectionIds((prev) => {
      if (prev.has(sectionId)) return prev
      const next = new Set(prev)
      next.add(sectionId)
      return next
    })
  }, [])

  const handleAddExerciseBlock = useCallback((exerciseId: string, block: ContentBlock) => {
    setExerciseBlocks((prev) => {
      const current = prev[exerciseId] ?? []
      return { ...prev, [exerciseId]: [...current, block] }
    })
    setDirtyExerciseIds((prev) => {
      if (prev.has(exerciseId)) return prev
      const next = new Set(prev)
      next.add(exerciseId)
      return next
    })
  }, [])

  const handleAddSection = useCallback(
    async (exerciseId: string, title: string) => {
      await createSectionUnderExercise(exerciseId, title)
      await refetch()
    },
    [refetch],
  )

  const handleAddExercise = useCallback(
    async (title: string) => {
      await createExerciseUnderLesson(lessonId, title)
      await refetch()
    },
    [lessonId, refetch],
  )

  const dirtyEntries = useMemo<DirtyEntry[]>(() => {
    const list: DirtyEntry[] = []
    for (const id of dirtySectionIds) {
      list.push({ kind: 'section', id, blocks: sectionBlocks[id] ?? [] })
    }
    for (const id of dirtyExerciseIds) {
      list.push({ kind: 'exercise', id, blocks: exerciseBlocks[id] ?? [] })
    }
    return list
  }, [dirtySectionIds, dirtyExerciseIds, sectionBlocks, exerciseBlocks])

  const totalDirtyCount = dirtySectionIds.size + dirtyExerciseIds.size

  const handleSaveAll = useCallback(async () => {
    if (dirtyEntries.length === 0) return
    const { succeeded } = await saveAll(dirtyEntries)
    if (succeeded.length === 0) return

    // Only clear an entry from the dirty set when its in-memory blocks are
    // still the exact reference we PATCHed. If the user edited during the
    // in-flight save, the change handler replaced the array with a new one;
    // clearing dirty in that case would silently discard those newer edits
    // on the next reload.
    const currentSections = sectionBlocksRef.current
    const currentExercises = exerciseBlocksRef.current
    setDirtySectionIds((prev) => {
      const next = new Set(prev)
      for (const { kind, id, savedBlocks } of succeeded) {
        if (kind !== 'section') continue
        if (currentSections[id] === savedBlocks) next.delete(id)
      }
      return next
    })
    setDirtyExerciseIds((prev) => {
      const next = new Set(prev)
      for (const { kind, id, savedBlocks } of succeeded) {
        if (kind !== 'exercise') continue
        if (currentExercises[id] === savedBlocks) next.delete(id)
      }
      return next
    })
  }, [dirtyEntries, saveAll])

  // Warn before nav-away if there are unsaved changes.
  useEffect(() => {
    if (totalDirtyCount === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [totalDirtyCount])

  if (loading) return <div className="studio-message">Loading lesson…</div>
  if (error) return <div className="studio-message studio-message-error">{error}</div>
  if (!tree) return <div className="studio-message">Lesson not found.</div>

  return (
    <EditorChromeProvider mode="compact" defaultRichTextView="edit">
      <div className={`studio-page studio-page--${viewMode}`}>
        <StudioToolbar
          lessonTitle={tree.lesson.title || 'Untitled Lesson'}
          lessonId={tree.lesson.id}
          dirtyCount={totalDirtyCount}
          saving={saving}
          errors={errors}
          onSave={handleSaveAll}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />

        {refetchError && (
          <div className="studio-refetch-warning" role="status">
            Couldn&apos;t refresh the lesson tree: {refetchError}. Any change you just made may
            still have landed on the server — reload the page to see the latest.
          </div>
        )}

        <main className="studio-content">
          {tree.exercises.length === 0 ? (
            <div className="studio-empty studio-empty-big">This lesson has no exercises yet.</div>
          ) : (
            <>
              {tree.exercises.map((exercise, index) => (
                <StudioExerciseCard
                  key={exercise.id}
                  index={index}
                  exercise={exercise}
                  sectionBlocksById={sectionBlocks}
                  exerciseBlocksById={exerciseBlocks}
                  dirtySectionIds={dirtySectionIds}
                  dirtyExerciseIds={dirtyExerciseIds}
                  onSectionBlockChange={handleSectionBlockChange}
                  onExerciseBlockChange={handleExerciseBlockChange}
                  onAddSectionBlock={handleAddSectionBlock}
                  onAddExerciseBlock={handleAddExerciseBlock}
                  onAddSection={handleAddSection}
                  viewMode={viewMode}
                />
              ))}
            </>
          )}
          <div className="studio-add-exercise-row">
            <AddChildButton
              label="Add exercise"
              placeholder="Exercise title"
              onSubmit={handleAddExercise}
            />
          </div>
        </main>
      </div>
    </EditorChromeProvider>
  )
}
