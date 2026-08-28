'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StudioTreeResponse } from '@/server/payload/endpoints/studio/lesson-tree'

interface UseStudioTreeResult {
  tree: StudioTreeResponse | null
  /**
   * `true` only during the initial fetch or a lesson-id change. Parent gates
   * its full-screen "Loading lesson…" UI on this. Background refetches (via
   * `refetch()`) never flip this — the tree stays mounted and any refetch
   * failure surfaces via `refetchError` instead.
   */
  loading: boolean
  /**
   * Populated only when the INITIAL fetch fails. Consumed by the parent's
   * error gate — a value here unmounts the studio, which is correct for
   * "can't load the lesson at all" but wrong for "background refresh failed."
   */
  error: string | null
  /**
   * Populated when a `refetch()` fails. Separate from `error` so a transient
   * network blip during a post-mutation refresh doesn't tear down the studio
   * (with any in-progress edits) via the parent's `if (error)` gate. Caller
   * should render this as an inline warning and let the user retry.
   */
  refetchError: string | null
  /**
   * Re-fetches the tree from the server. Does NOT flip `loading` so the
   * parent's `if (loading) return <Loader/>` gate doesn't unmount the studio
   * subtree, blowing away child editor state, cursor position, and any
   * expanded AddChildButton. Errors go into `refetchError` rather than
   * throwing.
   */
  refetch: () => Promise<void>
}

/**
 * Fetches the full lesson tree (lesson + exercises + sections) in one round-trip.
 * Backed by /api/studio/lessons/:id/tree.
 *
 * Two failure signals:
 *   - `error` — initial load couldn't produce a tree; parent unmounts.
 *   - `refetchError` — background refresh failed; parent shows an inline
 *      warning and keeps the studio mounted so in-progress edits survive.
 */
export function useStudioTree(lessonId: string): UseStudioTreeResult {
  const [tree, setTree] = useState<StudioTreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refetchError, setRefetchError] = useState<string | null>(null)

  const fetchTree = useCallback(
    async ({ silent, signal }: { silent: boolean; signal?: AbortSignal }) => {
      if (silent) {
        setRefetchError(null)
      } else {
        setLoading(true)
        setError(null)
      }
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
        // Route silent-mode failures into refetchError so the parent's error
        // gate (which unmounts the whole studio) doesn't fire on a transient
        // background refresh failure. Initial-load failures still go into
        // `error` because there's no tree to preserve.
        if (silent) setRefetchError((err as Error).message)
        else setError((err as Error).message)
      } finally {
        if (!silent) setLoading(false)
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

  return { tree, loading, error, refetchError, refetch }
}
