'use client'

import { useCallback, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

const SAVE_CONCURRENCY = 2

export interface SaveError {
  sectionId: string
  message: string
}

/**
 * A successful save reports the *reference* of the blocks array we actually
 * PATCHed. The caller compares that reference to the current in-memory blocks
 * to decide whether it's safe to clear the section's dirty flag — if the user
 * edited during the in-flight save, the reference will have moved on and the
 * dirty flag must stay set so those edits aren't silently dropped.
 */
export interface SaveSuccess {
  id: string
  savedBlocks: ContentBlock[]
}

interface UseStudioSaveResult {
  saving: boolean
  errors: SaveError[]
  savedCount: number
  saveAll: (
    dirtySections: Array<{ id: string; blocks: ContentBlock[] }>,
  ) => Promise<{ succeeded: SaveSuccess[]; failed: SaveError[] }>
  clearErrors: () => void
}

/**
 * Runs PATCH requests for a set of dirty sections with bounded concurrency so
 * we don't stampede the maxPoolSize=3 Mongo pool on a large lesson save.
 */
export function useStudioSave(): UseStudioSaveResult {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<SaveError[]>([])
  const [savedCount, setSavedCount] = useState(0)

  const clearErrors = useCallback(() => setErrors([]), [])

  const saveOne = useCallback(
    async (sectionId: string, blocks: ContentBlock[]): Promise<SaveError | null> => {
      try {
        const res = await fetch(`/api/sections/${sectionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content: { blocks } }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          return {
            sectionId,
            message: data?.error?.message || data?.error || `Save failed (${res.status})`,
          }
        }
        return null
      } catch (err) {
        return { sectionId, message: err instanceof Error ? err.message : 'Network error' }
      }
    },
    [],
  )

  const saveAll = useCallback(
    async (dirtySections: Array<{ id: string; blocks: ContentBlock[] }>) => {
      setSaving(true)
      setErrors([])
      setSavedCount(0)

      const queue = [...dirtySections]
      const failed: SaveError[] = []
      const succeeded: SaveSuccess[] = []

      const worker = async () => {
        while (queue.length > 0) {
          const next = queue.shift()
          if (!next) return
          const err = await saveOne(next.id, next.blocks)
          if (err) {
            failed.push(err)
          } else {
            succeeded.push({ id: next.id, savedBlocks: next.blocks })
            setSavedCount((prev) => prev + 1)
          }
        }
      }

      const workers = Array.from(
        { length: Math.min(SAVE_CONCURRENCY, dirtySections.length) },
        () => worker(),
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
