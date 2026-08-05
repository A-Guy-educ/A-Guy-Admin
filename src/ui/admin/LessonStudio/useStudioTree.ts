'use client'

import { useEffect, useState } from 'react'
import type { StudioTreeResponse } from '@/server/payload/endpoints/studio/lesson-tree'

interface UseStudioTreeResult {
  tree: StudioTreeResponse | null
  loading: boolean
  error: string | null
}

/**
 * Fetches the full lesson tree (lesson + exercises + sections) in one round-trip.
 * Backed by /api/studio/lessons/:id/tree.
 */
export function useStudioTree(lessonId: string): UseStudioTreeResult {
  const [tree, setTree] = useState<StudioTreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!lessonId) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`/api/studio/lessons/${lessonId}/tree`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Failed to load tree: ${res.status}`)
        }
        return res.json() as Promise<StudioTreeResponse>
      })
      .then((data) => {
        setTree(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      })

    return () => controller.abort()
  }, [lessonId])

  return { tree, loading, error }
}
