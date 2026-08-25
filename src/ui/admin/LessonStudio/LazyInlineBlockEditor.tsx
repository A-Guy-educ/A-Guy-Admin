'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

// Import the InlineBlockRenderer module lazily. All per-type editors
// (McqEditor, TrueFalseEditor, FreeResponseEditor, TableEditor, MatchingEditor,
// SvgEditor, HtmlBlockEditor, MediaBlockEditor, and the already-lazy geometry
// / axis editors) live under this module, so the entire editor dependency
// graph only downloads once the admin opens their first block.
const importEditor = () => import('../LessonBlocksField/InlineBlockRenderer')

// Cache the import promise so hover prefetch, focus prefetch, and the actual
// click all share the same in-flight fetch instead of racing.
let editorImportPromise: Promise<unknown> | null = null

/**
 * Kick off the InlineBlockRenderer chunk download without mounting the editor.
 * Safe to call repeatedly — only the first call triggers the network request.
 * Wire this to onMouseEnter/onFocus on the doc-view wrapper so the bundle is
 * usually already in memory by the time the admin actually clicks.
 */
export function prefetchInlineBlockEditor(): void {
  if (editorImportPromise) return
  editorImportPromise = importEditor()
}

const InlineBlockRendererDynamic = dynamic(
  () => importEditor().then((m) => m.InlineBlockRenderer),
  {
    ssr: false,
    loading: () => (
      <div className="studio-doc-editor-skeleton" aria-busy="true" aria-label="Loading editor">
        <div className="studio-doc-editor-skeleton-line" />
        <div className="studio-doc-editor-skeleton-line studio-doc-editor-skeleton-line--short" />
      </div>
    ),
  },
)

interface LazyInlineBlockEditorProps {
  block: ContentBlock
  onChange: (updated: ContentBlock) => void
}

/**
 * Thin wrapper around the lazily-loaded InlineBlockRenderer. Renders a
 * skeleton while the editor chunk downloads, then swaps in the real editor.
 */
export const LazyInlineBlockEditor: React.FC<LazyInlineBlockEditorProps> = ({
  block,
  onChange,
}) => {
  return <InlineBlockRendererDynamic block={block} onChange={onChange} />
}
