'use client'

import React, { useCallback, useEffect, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { InlineBlockRenderer } from './InlineBlockRenderer'
import { InlineSectionEditor } from './InlineSectionEditor'
import '../ExerciseContentEditor/index.css'

interface InlineExerciseEditorProps {
  exerciseId: string
  exerciseTitle?: string
  /** Called when the user saves changes to this exercise */
  onSave?: () => void
}

interface SectionSummary {
  id: string
  title: string | null
  blocks: ContentBlock[]
}

function cloneBlock(block: ContentBlock): ContentBlock {
  return JSON.parse(JSON.stringify(block))
}

/** Parse the exercise's blocks playlist (sectionRef entries) */
function parseSectionRefIds(raw: unknown): string[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })()
      : []

  const ids: string[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { blockType?: string; section?: unknown }
    if (e.blockType !== 'sectionRef') continue
    if (typeof e.section === 'string' && e.section.length > 0) {
      ids.push(e.section)
    } else if (e.section && typeof e.section === 'object' && 'id' in e.section) {
      const nested = (e.section as { id: unknown }).id
      if (typeof nested === 'string' && nested.length > 0) ids.push(nested)
    }
  }
  return ids
}

/**
 * InlineExerciseEditor — renders an exercise's content inline within the
 * LessonBlocksField.
 *
 * - If the exercise has child sections, each section is rendered as its own
 *   nested `InlineSectionEditor` (with per-section save).
 * - If not, falls back to editing the legacy `exercise.content.blocks`.
 *
 * Saves happen directly against the exercise/section REST endpoints,
 * independent of the lesson form.
 */
export const InlineExerciseEditor: React.FC<InlineExerciseEditorProps> = ({
  exerciseId,
  exerciseTitle,
  onSave,
}) => {
  const [sections, setSections] = useState<SectionSummary[] | null>(null)
  const [legacyBlocks, setLegacyBlocks] = useState<ContentBlock[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  useEffect(() => {
    if (!exerciseId) return

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`/api/exercises/${exerciseId}?depth=0`, {
        credentials: 'include',
        signal: controller.signal,
      }).then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch exercise: ${res.status}`)
        return res.json()
      }),
      // Do NOT swallow section-fetch errors: a transient failure here would
      // otherwise fall through to the legacy content.blocks branch below,
      // where `aggregateChildSectionContent`'s in-memory flattened output
      // would then be PATCHed back onto the exercise as if it were the
      // exercise's own content — silently freezing a stale snapshot that
      // ignores future section edits.
      fetch(
        `/api/sections?where[exercise][equals]=${encodeURIComponent(exerciseId)}&depth=0&limit=1000&sort=order`,
        { credentials: 'include', signal: controller.signal },
      ).then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch sections: ${res.status}`)
        return res.json()
      }),
    ])
      .then(([exerciseData, sectionsData]) => {
        const doc = exerciseData.doc || exerciseData
        type RawSection = {
          id: string
          title?: string | null
          content?: { blocks?: ContentBlock[] | null } | null
        }
        const rawSections: RawSection[] = Array.isArray(sectionsData?.docs) ? sectionsData.docs : []

        // Reorder sections to match the exercise's `blocks` playlist when present.
        const playlistIds = parseSectionRefIds(doc?.blocks)
        const byId = new Map(rawSections.map((s) => [s.id, s]))
        const toSummary = (s: RawSection): SectionSummary => ({
          id: s.id,
          title: s.title ?? null,
          blocks: Array.isArray(s.content?.blocks) ? s.content.blocks : [],
        })
        const ordered: SectionSummary[] = []
        const seen = new Set<string>()
        for (const id of playlistIds) {
          const match = byId.get(id)
          if (match && !seen.has(id)) {
            ordered.push(toSummary(match))
            seen.add(id)
          }
        }
        for (const s of rawSections) {
          if (!seen.has(s.id)) ordered.push(toSummary(s))
        }

        setSections(ordered)

        // Only surface legacy blocks when there are NO sections — otherwise the
        // `aggregateChildSectionContent` read hook has already flattened section
        // content into `doc.content.blocks`, and rendering it again would
        // duplicate everything we're about to show per-section.
        if (ordered.length === 0) {
          const blocks = doc?.content?.blocks || []
          setLegacyBlocks(blocks.map(cloneBlock))
        } else {
          setLegacyBlocks(null)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      })

    return () => controller.abort()
  }, [exerciseId])

  const handleLegacyBlockChange = useCallback((index: number, updated: ContentBlock) => {
    setLegacyBlocks((prev) => {
      if (!prev) return prev
      const next = [...prev]
      next[index] = updated
      return next
    })
    setHasUnsavedChanges(true)
  }, [])

  const handleSaveLegacy = useCallback(async () => {
    if (!exerciseId || !legacyBlocks || saving) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/exercises/${exerciseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: { blocks: legacyBlocks } }),
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
  }, [exerciseId, legacyBlocks, saving, onSave])

  if (loading) {
    return (
      <div
        style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--theme-elevation-500)',
          fontSize: 13,
        }}
      >
        Loading exercise...
      </div>
    )
  }

  if (error && !sections && !legacyBlocks) {
    return (
      <div style={{ padding: '16px', color: 'var(--theme-error-500)', fontSize: 13 }}>{error}</div>
    )
  }

  // Case 1: exercise has child sections — render each section inline
  if (sections && sections.length > 0) {
    return (
      <div className="inline-exercise-editor">
        <div className="inline-exercise-header">
          <div className="inline-exercise-title">{exerciseTitle || 'Untitled Exercise'}</div>
        </div>
        <div className="inline-exercise-blocks">
          {sections.map((section) => (
            <InlineSectionEditor
              key={section.id}
              sectionId={section.id}
              sectionTitle={section.title ?? undefined}
              preloadedBlocks={section.blocks}
              onSave={onSave}
            />
          ))}
        </div>
      </div>
    )
  }

  // Case 2: legacy exercise with inline content.blocks
  if (!legacyBlocks || legacyBlocks.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--theme-elevation-500)',
          fontSize: 13,
        }}
      >
        No content blocks or sections in this exercise.
      </div>
    )
  }

  return (
    <div className="inline-exercise-editor">
      <div className="inline-exercise-header">
        <div className="inline-exercise-title">{exerciseTitle || 'Untitled Exercise'}</div>
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
              onClick={handleSaveLegacy}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {!hasUnsavedChanges && !error && saving && (
            <span style={{ fontSize: 12, color: 'var(--theme-elevation-500)' }}>Saved</span>
          )}
        </div>
      </div>

      <div className="inline-exercise-blocks">
        {legacyBlocks.map((block, index) => (
          <div key={block.id || `block-${index}`} className="inline-exercise-block-item">
            <InlineBlockRenderer
              block={block}
              onChange={(updated) => handleLegacyBlockChange(index, updated)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
