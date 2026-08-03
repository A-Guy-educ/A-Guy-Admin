'use client'

import React, { useCallback, useEffect, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { InlineBlockRenderer } from './InlineBlockRenderer'
import '../ExerciseContentEditor/index.css'

interface InlineSectionEditorProps {
  sectionId: string
  sectionTitle?: string
  /** Preloaded section content.blocks — when provided, skips the initial fetch. */
  preloadedBlocks?: ContentBlock[] | null
  onSave?: () => void
}

function cloneBlock(block: ContentBlock): ContentBlock {
  return JSON.parse(JSON.stringify(block))
}

/**
 * InlineSectionEditor — renders a section's `content.blocks` inline with
 * per-section dirty tracking + save. Saves via PATCH to `/api/sections/{id}`,
 * independent of any parent form.
 *
 * If `preloadedBlocks` is provided the initial fetch is skipped. Callers
 * batch-fetch all sections for an exercise once (see `ExerciseBlocksList`
 * full mode and `InlineExerciseEditor`) to avoid N+1 same-origin GETs that
 * would otherwise saturate the browser's HTTP/1.1 connection budget.
 */
export const InlineSectionEditor: React.FC<InlineSectionEditorProps> = ({
  sectionId,
  sectionTitle,
  preloadedBlocks,
  onSave,
}) => {
  const [localBlocks, setLocalBlocks] = useState<ContentBlock[] | null>(
    preloadedBlocks ? preloadedBlocks.map(cloneBlock) : null,
  )
  const [loading, setLoading] = useState(preloadedBlocks === undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  useEffect(() => {
    if (!sectionId) return
    if (preloadedBlocks !== undefined) return

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`/api/sections/${sectionId}?depth=0`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch section: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        const doc = data.doc || data
        const blocks = doc?.content?.blocks || []
        setLocalBlocks(blocks.map(cloneBlock))
        setLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      })

    return () => controller.abort()
  }, [sectionId, preloadedBlocks])

  const handleBlockChange = useCallback((index: number, updated: ContentBlock) => {
    setLocalBlocks((prev) => {
      if (!prev) return prev
      const next = [...prev]
      next[index] = updated
      return next
    })
    setHasUnsavedChanges(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!sectionId || !localBlocks || saving) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: { blocks: localBlocks } }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error?.message || `Save failed: ${res.status}`)
      }

      setHasUnsavedChanges(false)
      onSave?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [sectionId, localBlocks, saving, onSave])

  if (loading) {
    return (
      <div
        style={{
          padding: '12px 16px',
          textAlign: 'center',
          color: 'var(--theme-elevation-500)',
          fontSize: 12,
        }}
      >
        Loading section...
      </div>
    )
  }

  if (error && !localBlocks) {
    return (
      <div style={{ padding: '12px 16px', color: 'var(--theme-error-500)', fontSize: 12 }}>
        {error}
      </div>
    )
  }

  return (
    <div className="inline-exercise-editor" style={{ marginLeft: 16 }}>
      <div className="inline-exercise-header">
        <div className="inline-exercise-title" style={{ fontSize: 13, fontStyle: 'italic' }}>
          {sectionTitle || 'Untitled Section'}
        </div>
        <div className="inline-exercise-actions">
          {error && (
            <span style={{ fontSize: 12, color: 'var(--theme-error-500)', marginRight: 8 }}>
              {error}
            </span>
          )}
          {hasUnsavedChanges && (
            <button
              type="button"
              className="editor-save-button"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {localBlocks && localBlocks.length === 0 ? (
        <div
          style={{
            padding: '12px 16px',
            textAlign: 'center',
            color: 'var(--theme-elevation-500)',
            fontSize: 12,
          }}
        >
          No content blocks in this section.
        </div>
      ) : (
        <div className="inline-exercise-blocks">
          {localBlocks?.map((block, index) => (
            <div key={block.id || `block-${index}`} className="inline-exercise-block-item">
              <InlineBlockRenderer
                block={block}
                onChange={(updated) => handleBlockChange(index, updated)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
