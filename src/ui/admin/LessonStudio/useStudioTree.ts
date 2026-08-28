'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StudioTreeResponse } from '@/server/payload/endpoints/studio/lesson-tree'

interface UseStudioTreeResult {
  tree: StudioTreeResponse | null
  loading: boolean
  error: string | null
  /**
   * Re-fetches the tree from the server. Used after mutations (create
   * exercise / create section) so the studio picks up newly-created rows
   * (and any playlist-append side effects from Payload afterChange hooks)
   * without a full page reload.
   */
  refetch: () => Promise<void>
}

/**
 * Fetches the full lesson tree (lesson + exercises + sections) in one round-trip.
 * Backed by /api/studio/lessons/:id/tree.
 */
export function useStudioTree(lessonId: string): UseStudioTreeResult {
  const [tree, setTree] = useState<StudioTreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTree = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/studio/lessons/${lessonId}/tree`, {
          credentials: 'include',
          signal,
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Failed to load tree: ${res.status}`)
        }
        const data = (await res.json()) as StudioTreeResponse
        setTree(data)
        setLoading(false)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
        setLoading(false)
      }
    },
    [lessonId],
  )

  useEffect(() => {
    if (!lessonId) return
    const controller = new AbortController()
    void fetchTree(controller.signal)
    return () => controller.abort()
  }, [lessonId, fetchTree])

  const refetch = useCallback(async () => {
    await fetchTree()
  }, [fetchTree])

  return { tree, loading, error, refetch }
}
