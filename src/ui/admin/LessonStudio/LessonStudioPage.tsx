'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

import { AddChildButton } from './AddChildButton'
import { StudioExerciseCard, type RowOp } from './StudioExerciseCard'
import { StudioToolbar } from './StudioToolbar'
import {
  createExerciseUnderLesson,
  createSectionUnderExercise,
  deleteExerciseCascade,
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

  // Row-op state — keyed by `${kind}:${id}` so a section and its parent
  // exercise get separate slots. Value is the in-flight op label the toolbar
  // uses to show "Deleting…" / "Duplicating…" and to disable buttons.
  const [pendingRowOps, setPendingRowOps] = useState<Record<string, RowOp | undefined>>({})
  // Single-slot error banner for row ops (delete/duplicate). Save errors have
  // their own toolbar slot in `useStudioSave`; this one covers the one-shot
  // mutations only. Kept as one message (not a list) because these ops are
  // fired one at a time.
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

  // Row-op ref mirror. Two purposes:
  //   1. Fast-path short-circuit in `runRowOp` — read the ref synchronously
  //      before we've committed the state update, so a two-clicks-in-one-tick
  //      race can't fire two duplicate/delete requests for the same row.
  //   2. Write-before-setState — we bump the ref before calling setState so a
  //      re-entrant call within the same microtask sees "busy" immediately.
  const pendingRowOpsRef = useRef(pendingRowOps)
  useEffect(() => {
    pendingRowOpsRef.current = pendingRowOps
  }, [pendingRowOps])

  // Latest tree in ref form so cascade cleanup handlers (which live in
  // useCallback wrappers) can look up child section ids at call time without
  // re-creating the callback on every tree change.
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

  // Delete-block guards are BOTH render-time (via `canDeleteBlock` in the
  // child component) AND state-time (via the `current.length <= 1` short-
  // circuit inside the setter). The state-time check is the authoritative
  // gate — the render-time check disappears when React re-renders between
  // two rapid clicks and can't stop a same-microtask double-click race.
  const handleDeleteSectionBlock = useCallback((sectionId: string, index: number) => {
    setSectionBlocks((prev) => {
      const current = prev[sectionId]
      if (!current) return prev
      // ContentSchema requires blocks.length >= 1 — never let the last one go.
      if (current.length <= 1) return prev
      const next = current.filter((_, i) => i !== index)
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
      if (current.length <= 1) return prev
      const next = current.filter((_, i) => i !== index)
      return { ...prev, [exerciseId]: next }
    })
    setDirtyExerciseIds((prev) => {
      if (prev.has(exerciseId)) return prev
      const next = new Set(prev)
      next.add(exerciseId)
      return next
    })
  }, [])

  // Row-op wrapper. Enforces "one op per row at a time" via the ref mirror,
  // writes the busy label into state so the toolbar can render it, and clears
  // the slot in a finally so the toolbar re-enables on both success and
  // failure. On failure it surfaces the message via `actionError` — no throw
  // to callers, so the child's onClick handler doesn't need its own catch.
  const runRowOp = useCallback(
    async (key: string, op: RowOp, work: () => Promise<void>): Promise<void> => {
      // Same-microtask short-circuit: ref is updated BEFORE the state batch
      // commits, so a second click in the same tick sees "busy" and no-ops.
      if (pendingRowOpsRef.current[key]) return
      pendingRowOpsRef.current = { ...pendingRowOpsRef.current, [key]: op }
      setPendingRowOps((prev) => ({ ...prev, [key]: op }))
      setActionError(null)
      try {
        await work()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        // Drop the key entirely (not `undefined`) so the state object doesn't
        // accumulate every row ever touched. Ref goes first, same reason as
        // the busy write above.
        const nextRef = { ...pendingRowOpsRef.current }
        delete nextRef[key]
        pendingRowOpsRef.current = nextRef
        setPendingRowOps((prev) => {
          if (prev[key] == null) return prev
          const next = { ...prev }
          delete next[key]
          return next
        })
      }
    },
    [],
  )

  const handleAddSection = useCallback(
    async (exerciseId: string, title: string, insertAfter?: string) => {
      await createSectionUnderExercise(exerciseId, { title, insertAfter })
      await refetch()
    },
    [refetch],
  )

  const handleAddExercise = useCallback(
    async (title: string) => {
      await createExerciseUnderLesson(lessonId, { title })
      await refetch()
    },
    [lessonId, refetch],
  )

  const handleDeleteSection = useCallback(
    async (sectionId: string) => {
      await runRowOp(`section:${sectionId}`, 'delete', async () => {
        await deleteSection(sectionId)
        // Clean local state before refetch so the seed effect doesn't see a
        // stale dirty entry pointing at a section that no longer exists on
        // the server (which would keep it "dirty preserved" forever).
        setSectionBlocks((prev) => {
          if (!(sectionId in prev)) return prev
          const next = { ...prev }
          delete next[sectionId]
          return next
        })
        setDirtySectionIds((prev) => {
          if (!prev.has(sectionId)) return prev
          const next = new Set(prev)
          next.delete(sectionId)
          return next
        })
        await refetch()
      })
    },
    [refetch, runRowOp],
  )

  const handleDeleteExercise = useCallback(
    async (exerciseId: string) => {
      await runRowOp(`exercise:${exerciseId}`, 'delete', async () => {
        // Snapshot the child section ids BEFORE the server delete so cascade
        // cleanup below still has them (post-refetch the exercise is gone).
        const currentTree = treeRef.current
        const exercise = currentTree?.exercises.find((ex) => ex.id === exerciseId)
        const childSectionIds = exercise ? exercise.sections.map((s) => s.id) : []

        await deleteExerciseCascade(exerciseId)

        setExerciseBlocks((prev) => {
          if (!(exerciseId in prev)) return prev
          const next = { ...prev }
          delete next[exerciseId]
          return next
        })
        setDirtyExerciseIds((prev) => {
          if (!prev.has(exerciseId)) return prev
          const next = new Set(prev)
          next.delete(exerciseId)
          return next
        })
        // Cascade-clean child section dirty + block entries — the server
        // deleted them too and leaving them "dirty" would surface on the
        // next save as 404s pointing at gone sections.
        if (childSectionIds.length > 0) {
          setSectionBlocks((prev) => {
            let mutated = false
            const next = { ...prev }
            for (const id of childSectionIds) {
              if (id in next) {
                delete next[id]
                mutated = true
              }
            }
            return mutated ? next : prev
          })
          setDirtySectionIds((prev) => {
            let mutated = false
            const next = new Set(prev)
            for (const id of childSectionIds) {
              if (next.delete(id)) mutated = true
            }
            return mutated ? next : prev
          })
        }
        await refetch()
      })
    },
    [refetch, runRowOp],
  )

  const handleDuplicateSection = useCallback(
    async (sectionId: string) => {
      await runRowOp(`section:${sectionId}`, 'duplicate', async () => {
        await duplicateSection(sectionId)
        await refetch()
      })
    },
    [refetch, runRowOp],
  )

  const handleDuplicateExercise = useCallback(
    async (exerciseId: string) => {
      await runRowOp(`exercise:${exerciseId}`, 'duplicate', async () => {
        const { repositioned, reason } = await duplicateExercise(exerciseId, lessonId)
        await refetch()
        if (!repositioned) {
          // Duplicate succeeded but the follow-up reorder call failed. The
          // copy exists at the END of the lesson's playlist rather than
          // right after the source. Non-fatal — surface a warning that
          // includes the underlying reason so the admin has a diagnostic,
          // not just a symptom.
          const base =
            'Duplicate created, but couldn’t reposition it below the source. Check the end of the lesson.'
          setActionError(reason ? `${base} (${reason})` : base)
        }
      })
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
    <EditorChromeProvider mode="compact">
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
          <div className="studio-action-error" role="alert">
            <span>{actionError}</span>
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
                // `+ Add exercise` renders between every card so admins can
                // slot a new one between two existing exercises. The last
                // (non-between) one lives outside the map below.
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
                  <div className="studio-add-exercise-row">
                    <AddChildButton
                      label="Add exercise"
                      placeholder="Exercise title"
                      onSubmit={async (title) => {
                        await createExerciseUnderLesson(lessonId, {
                          title,
                          insertAfter: exercise.id,
                        })
                        await refetch()
                      }}
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
                onSubmit={handleAddExercise}
              />
            </div>
          )}
        </main>
      </div>
    </EditorChromeProvider>
  )
}
