'use client'

import { useCallback, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

const SAVE_CONCURRENCY = 2

export type DirtyKind = 'section' | 'exercise'

export interface DirtyEntry {
  kind: DirtyKind
  id: string
  blocks: ContentBlock[]
}

export interface SaveError {
  kind: DirtyKind
  id: string
  message: string
}

/**
 * A successful save reports the *reference* of the blocks array we actually
 * PATCHed. The caller compares that reference to the current in-memory blocks
 * to decide whether it's safe to clear the entry's dirty flag — if the user
 * edited during the in-flight save, the reference will have moved on and the
 * dirty flag must stay set so those edits aren't silently dropped.
 */
export interface SaveSuccess {
  kind: DirtyKind
  id: string
  savedBlocks: ContentBlock[]
}

interface UseStudioSaveResult {
  saving: boolean
  errors: SaveError[]
  savedCount: number
  saveAll: (entries: DirtyEntry[]) => Promise<{ succeeded: SaveSuccess[]; failed: SaveError[] }>
  clearErrors: () => void
}

function endpointFor(kind: DirtyKind, id: string): string {
  if (kind === 'exercise') return `/api/exercises/${id}`
  return `/api/sections/${id}`
}

function bodyFor(kind: DirtyKind, blocks: ContentBlock[]): string {
  // Sections and exercises both store content under `content.blocks`.
  return JSON.stringify({ content: { blocks } })
}

/**
 * Runs PATCH requests for a set of dirty entries (sections + exercises) with
 * bounded concurrency so we don't stampede the maxPoolSize=3 Mongo pool on a
 * large lesson save.
 */
export function useStudioSave(): UseStudioSaveResult {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<SaveError[]>([])
  const [savedCount, setSavedCount] = useState(0)

  const clearErrors = useCallback(() => setErrors([]), [])

  const saveOne = useCallback(async (entry: DirtyEntry): Promise<SaveError | null> => {
    try {
      const res = await fetch(endpointFor(entry.kind, entry.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: bodyFor(entry.kind, entry.blocks),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return {
          kind: entry.kind,
          id: entry.id,
          message: data?.error?.message || data?.error || `Save failed (${res.status})`,
        }
      }
      return null
    } catch (err) {
      return {
        kind: entry.kind,
        id: entry.id,
        message: err instanceof Error ? err.message : 'Network error',
      }
    }
  }, [])

  const saveAll = useCallback(
    async (entries: DirtyEntry[]) => {
      setSaving(true)
      setErrors([])
      setSavedCount(0)

      const queue = [...entries]
      const failed: SaveError[] = []
      const succeeded: SaveSuccess[] = []

      const worker = async () => {
        while (queue.length > 0) {
          const next = queue.shift()
          if (!next) return
          const err = await saveOne(next)
          if (err) {
            failed.push(err)
          } else {
            succeeded.push({ kind: next.kind, id: next.id, savedBlocks: next.blocks })
            setSavedCount((prev) => prev + 1)
          }
        }
      }

      const workers = Array.from({ length: Math.min(SAVE_CONCURRENCY, entries.length) }, () =>
        worker(),
      )
      await Promise.all(workers)

      setErrors(failed)
      setSaving(false)
      return { succeeded, failed }
    },
    [saveOne],
  )

  return { saving, errors, savedCount, saveAll, clearErrors }
}
