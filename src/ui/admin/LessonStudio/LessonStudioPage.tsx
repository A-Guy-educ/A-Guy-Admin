'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

import { AddChildButton } from './AddChildButton'
import { StudioExerciseCard } from './StudioExerciseCard'
import { StudioToolbar } from './StudioToolbar'
import {
  createExerciseUnderLesson,
  createSectionUnderExercise,
  deleteExercise,
  deleteSection,
  duplicateExercise,
  duplicateSection,
} from './studioCreateApi'
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

  // In-flight guards: prevent double-submit on Delete / Duplicate row buttons.
  // Keyed by "section:<id>" or "exercise:<id>" so the same UI can gate both
  // operations independently. `actionError` surfaces the last failure inline
  // (same slot as refetchError) so admins see a signal when a delete/duplicate
  // silently fails — instead of nothing happening and the item still there.
  const [pendingRowOps, setPendingRowOps] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)

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

  // Ref mirror of the tree so delete-cascade handlers can look up a deleted
  // exercise's child section ids WITHOUT taking `tree` as a useCallback dep
  // (which would recreate every handler on every tree change and thrash
  // memoization). Read-only — the seed effect owns tree writes.
  const treeRef = useRef(tree)
  useEffect(() => {
    treeRef.current = tree
  }, [tree])

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
    async (exerciseId: string, title: string, insertAfter?: string) => {
      await createSectionUnderExercise(exerciseId, { title, insertAfter })
      await refetch()
    },
    [refetch],
  )

  const handleAddExercise = useCallback(
    async (title: string, insertAfter?: string) => {
      await createExerciseUnderLesson(lessonId, { title, insertAfter })
      await refetch()
    },
    [lessonId, refetch],
  )

  const handleDeleteSectionBlock = useCallback((sectionId: string, index: number) => {
    setSectionBlocks((prev) => {
      const current = prev[sectionId]
      if (!current) return prev
      const next = [...current]
      next.splice(index, 1)
      return { ...prev, [sectionId]: next }
    })
    setDirtySectionIds((prev) => {
      if (prev.has(sectionId)) return prev
      const next = new Set(prev)
      next.add(sectionId)
      return next
    })
  }, [])

  const handleDeleteExerciseBlock = useCallback((exerciseId: string, index: number) => {
    setExerciseBlocks((prev) => {
      const current = prev[exerciseId]
      if (!current) return prev
      const next = [...current]
      next.splice(index, 1)
      return { ...prev, [exerciseId]: next }
    })
    setDirtyExerciseIds((prev) => {
      if (prev.has(exerciseId)) return prev
      const next = new Set(prev)
      next.add(exerciseId)
      return next
    })
  }, [])

  // In-flight tracking uses a REF for the source-of-truth check so the
  // "is this key already pending?" test is synchronous and doesn't rely on
  // a state updater side-effect (React requires updater functions to be pure
  // and StrictMode / concurrent mode will invoke them multiple times). The
  // ref stays in sync via its own effect below. `setPendingRowOps` is still
  // called so React re-renders and the row buttons re-evaluate their disabled
  // state; the ref is the authoritative gate.
  const pendingRowOpsRef = useRef(pendingRowOps)
  useEffect(() => {
    pendingRowOpsRef.current = pendingRowOps
  }, [pendingRowOps])

  // Wrap a row-scoped async op with (a) an in-flight guard so double-clicks
  // don't fire twice, (b) a try/catch that surfaces the error via
  // `actionError` instead of throwing into the void. `key` identifies the
  // operation; typically "delete-section:<id>" or "duplicate-exercise:<id>".
  const runRowOp = useCallback(async (key: string, op: () => Promise<void>): Promise<boolean> => {
    if (pendingRowOpsRef.current.has(key)) return false
    // Optimistically update the ref so a rapid second call sees the guard
    // before React commits. The state update below is what causes the row
    // buttons to actually disable in the UI.
    const nextRef = new Set(pendingRowOpsRef.current)
    nextRef.add(key)
    pendingRowOpsRef.current = nextRef
    setPendingRowOps(nextRef)
    setActionError(null)
    try {
      await op()
      return true
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
      return false
    } finally {
      const afterRef = new Set(pendingRowOpsRef.current)
      afterRef.delete(key)
      pendingRowOpsRef.current = afterRef
      setPendingRowOps(afterRef)
    }
  }, [])

  const handleDeleteSection = useCallback(
    async (sectionId: string, sectionTitle: string) => {
      // Confirm via a native prompt — matches the "maybe have a popup" ask
      // without pulling in a modal component. Delete is destructive and
      // Payload's afterDelete hook cleans up the parent playlist for us.
      if (!window.confirm(`Delete section "${sectionTitle || 'Untitled Section'}"?`)) return
      const ok = await runRowOp(`delete-section:${sectionId}`, () => deleteSection(sectionId))
      if (!ok) return
      // Drop the deleted section from local dirty + blocks maps BEFORE refetch.
      // Otherwise the dirty-aware seed effect preserves ghost dirty ids even
      // when the server no longer has them, and Save All will PATCH the
      // missing id forever.
      setDirtySectionIds((prev) => {
        if (!prev.has(sectionId)) return prev
        const next = new Set(prev)
        next.delete(sectionId)
        return next
      })
      setSectionBlocks((prev) => {
        if (!(sectionId in prev)) return prev
        const { [sectionId]: _dropped, ...rest } = prev
        void _dropped
        return rest
      })
      await refetch()
    },
    [refetch, runRowOp],
  )

  const handleDeleteExercise = useCallback(
    async (exerciseId: string, exerciseTitle: string) => {
      if (
        !window.confirm(
          `Delete exercise "${exerciseTitle || 'Untitled Exercise'}" and all of its sections?`,
        )
      )
        return
      // Snapshot the child section ids BEFORE the delete + refetch — after
      // refetch the tree no longer knows about the deleted exercise, so we'd
      // lose the ability to evict them. Any of these that were dirty become
      // ghosts the dirty-aware seed effect happily preserves, which then
      // makes Save All PATCH a deleted section forever (404).
      const childSectionIds: string[] = []
      const treeSnapshot = treeRef.current
      if (treeSnapshot) {
        const parent = treeSnapshot.exercises.find((e) => e.id === exerciseId)
        if (parent) for (const s of parent.sections) childSectionIds.push(s.id)
      }

      const ok = await runRowOp(`delete-exercise:${exerciseId}`, () => deleteExercise(exerciseId))
      if (!ok) return

      // Cascade the ghost cleanup: the parent exercise + every child section
      // that lived under it. Missing any of them recreates the CRITICAL
      // dirty-ghost bug for the cascade case.
      setDirtyExerciseIds((prev) => {
        if (!prev.has(exerciseId)) return prev
        const next = new Set(prev)
        next.delete(exerciseId)
        return next
      })
      setExerciseBlocks((prev) => {
        if (!(exerciseId in prev)) return prev
        const { [exerciseId]: _dropped, ...rest } = prev
        void _dropped
        return rest
      })
      if (childSectionIds.length > 0) {
        setDirtySectionIds((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const id of childSectionIds) {
            if (next.delete(id)) changed = true
          }
          return changed ? next : prev
        })
        setSectionBlocks((prev) => {
          let changed = false
          const next: Record<string, ContentBlock[]> = { ...prev }
          for (const id of childSectionIds) {
            if (id in next) {
              delete next[id]
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
      await refetch()
    },
    [refetch, runRowOp],
  )

  const handleDuplicateSection = useCallback(
    async (sectionId: string) => {
      const ok = await runRowOp(`duplicate-section:${sectionId}`, () =>
        duplicateSection(sectionId).then(() => undefined),
      )
      if (ok) await refetch()
    },
    [refetch, runRowOp],
  )

  const handleDuplicateExercise = useCallback(
    async (exerciseId: string) => {
      let repositioned = true
      const ok = await runRowOp(`duplicate-exercise:${exerciseId}`, async () => {
        const result = await duplicateExercise(exerciseId, lessonId)
        repositioned = result.repositioned
      })
      if (!ok) return
      // Surface the "landed at end instead of right below" case so the
      // button title's promise ("creates a copy right below this one")
      // stays honest. Non-blocking — refetch still runs and the copy
      // shows wherever the server placed it.
      if (!repositioned) {
        setActionError(
          "Exercise duplicated, but couldn't be moved right below the source — the copy is at the end of the list.",
        )
      }
      await refetch()
    },
    [lessonId, refetch, runRowOp],
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
        {actionError && (
          <div className="studio-refetch-warning" role="alert">
            {actionError}
            <button
              type="button"
              className="studio-action-error-dismiss"
              onClick={() => setActionError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <main className="studio-content">
          {tree.exercises.length === 0 ? (
            <div className="studio-empty studio-empty-big">This lesson has no exercises yet.</div>
          ) : (
            <>
              {tree.exercises.map((exercise, index) => (
                <React.Fragment key={exercise.id}>
                  <StudioExerciseCard
                    index={index}
                    exercise={exercise}
                    sectionBlocksById={sectionBlocks}
                    exerciseBlocksById={exerciseBlocks}
                    dirtySectionIds={dirtySectionIds}
                    dirtyExerciseIds={dirtyExerciseIds}
                    pendingRowOps={pendingRowOps}
                    onSectionBlockChange={handleSectionBlockChange}
                    onExerciseBlockChange={handleExerciseBlockChange}
                    onAddSectionBlock={handleAddSectionBlock}
                    onAddExerciseBlock={handleAddExerciseBlock}
                    onDeleteSectionBlock={handleDeleteSectionBlock}
                    onDeleteExerciseBlock={handleDeleteExerciseBlock}
                    onAddSection={handleAddSection}
                    onDeleteSection={handleDeleteSection}
                    onDeleteExercise={handleDeleteExercise}
                    onDuplicateSection={handleDuplicateSection}
                    onDuplicateExercise={handleDuplicateExercise}
                    viewMode={viewMode}
                  />
                  {/* +Add exercise between this exercise and the next — same
                      component that lives at the end of the list; passing
                      insertAfter targets the placement server-side. */}
                  <div className="studio-add-exercise-row">
                    <AddChildButton
                      label="Add exercise"
                      placeholder="Exercise title"
                      onSubmit={(title) => handleAddExercise(title, exercise.id)}
                    />
                  </div>
                </React.Fragment>
              ))}
            </>
          )}
          {tree.exercises.length === 0 && (
            <div className="studio-add-exercise-row">
              <AddChildButton
                label="Add exercise"
                placeholder="Exercise title"
                onSubmit={(title) => handleAddExercise(title)}
              />
            </div>
          )}
        </main>
      </div>
    </EditorChromeProvider>
  )
}
