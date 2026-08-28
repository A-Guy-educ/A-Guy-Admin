'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StudioTreeResponse } from '@/server/payload/endpoints/studio/lesson-tree'

interface UseStudioTreeResult {
  tree: StudioTreeResponse | null
  loading: boolean
  /**
   * `true` while a background refetch is in flight (e.g. after +Add section).
   * Callers can render a subtle indicator without unmounting the studio like
   * they would if the top-level `loading` gate were used.
   */
  refetching: boolean
  error: string | null
  /**
   * Re-fetches the tree from the server. Does NOT flip `loading` — using
   * `refetching` instead so the parent's `if (loading) return <Loader/>`
   * gate doesn't unmount the studio subtree, blowing away child editor
   * state, cursor position, and any expanded AddChildButton.
   */
  refetch: () => Promise<void>
}

/**
 * Fetches the full lesson tree (lesson + exercises + sections) in one round-trip.
 * Backed by /api/studio/lessons/:id/tree.
 *
 * Two loading signals:
 *   - `loading` — initial mount / lesson-id change. Parent uses this to
 *      render the full-screen "Loading lesson…" gate.
 *   - `refetching` — a post-mutation refetch. Parent should NOT unmount on
 *      this; the tree is still valid, just about to be replaced.
 */
export function useStudioTree(lessonId: string): UseStudioTreeResult {
  const [tree, setTree] = useState<StudioTreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refetching, setRefetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTree = useCallback(
    async ({ silent, signal }: { silent: boolean; signal?: AbortSignal }) => {
      if (silent) setRefetching(true)
      else setLoading(true)
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
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
      } finally {
        if (silent) setRefetching(false)
        else setLoading(false)
      }
    },
    [lessonId],
  )

  useEffect(() => {
    if (!lessonId) return
    const controller = new AbortController()
    void fetchTree({ silent: false, signal: controller.signal })
    return () => controller.abort()
  }, [lessonId, fetchTree])

  const refetch = useCallback(async () => {
    await fetchTree({ silent: true })
  }, [fetchTree])

  return { tree, loading, refetching, error, refetch }
}
