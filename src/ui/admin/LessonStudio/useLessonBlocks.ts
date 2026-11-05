'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

interface UseLessonBlocksResult {
  blocks: ContentBlock[]
  dirty: boolean
  onBlockChange: (index: number, updated: ContentBlock) => void
  onAddBlock: (block: ContentBlock, insertAt?: number) => void
  onDeleteBlock: (index: number) => void
  onReplaceBlocks: (blocks: ContentBlock[]) => void
  /**
   * Clears the dirty flag only if `savedBlocks` is still the exact array in
   * memory — edits made during the in-flight save keep the lesson dirty.
   */
  markSaved: (savedBlocks: ContentBlock[]) => void
}

/**
 * Local edit state for the lesson's own `content.blocks`. Mirrors the
 * section/exercise maps in LessonStudioPage, but for a single container:
 * seeded from the tree on load/refetch unless there are unsaved edits.
 */
export function useLessonBlocks(serverBlocks: ContentBlock[] | undefined): UseLessonBlocksResult {
  const [blocks, setBlocks] = useState<ContentBlock[]>([])
  const [dirty, setDirty] = useState(false)

  const blocksRef = useRef(blocks)
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    blocksRef.current = blocks
  }, [blocks])
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // Dirty-aware seed — refetches after +Add exercise etc. must not wipe
  // in-progress lesson edits.
  useEffect(() => {
    if (!serverBlocks || dirtyRef.current) return
    setBlocks(JSON.parse(JSON.stringify(serverBlocks)))
  }, [serverBlocks])

  const onBlockChange = useCallback((index: number, updated: ContentBlock) => {
    setBlocks((prev) => prev.map((block, i) => (i === index ? updated : block)))
    setDirty(true)
  }, [])

  const onAddBlock = useCallback((block: ContentBlock, insertAt?: number) => {
    setBlocks((prev) => {
      const at = insertAt == null ? prev.length : Math.max(0, Math.min(insertAt, prev.length))
      return [...prev.slice(0, at), block, ...prev.slice(at)]
    })
    setDirty(true)
  }, [])

  const onDeleteBlock = useCallback((index: number) => {
    // ContentSchema requires blocks.length >= 1 — never let the last one go.
    setBlocks((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
    setDirty(true)
  }, [])

  const onReplaceBlocks = useCallback((next: ContentBlock[]) => {
    setBlocks(next)
    setDirty(true)
  }, [])

  const markSaved = useCallback((savedBlocks: ContentBlock[]) => {
    if (blocksRef.current === savedBlocks) setDirty(false)
  }, [])

  return { blocks, dirty, onBlockChange, onAddBlock, onDeleteBlock, onReplaceBlocks, markSaved }
}
