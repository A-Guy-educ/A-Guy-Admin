'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { InlineBlockRenderer } from '../LessonBlocksField/InlineBlockRenderer'
import { RichTextDocView } from './docViews/RichTextDocView'
import { QuestionDocView } from './docViews/QuestionDocView'
import { LatexDocView } from './docViews/LatexDocView'
import { SvgDocView } from './docViews/SvgDocView'
import { AxisDocView } from './docViews/AxisDocView'
import { GeometryDocView } from './docViews/GeometryDocView'
import { MultiAxisDocView } from './docViews/MultiAxisDocView'

interface StudioDocBlockProps {
  block: ContentBlock
  onChange: (updated: ContentBlock) => void
}

/**
 * Word-style wrapper: renders a read-only preview of a block, and swaps to
 * the full `InlineBlockRenderer` editor on click. Only the block that's being
 * edited shows editor chrome — the rest of the document stays clean.
 */
export const StudioDocBlock: React.FC<StudioDocBlockProps> = ({ block, onChange }) => {
  const [editing, setEditing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const stopEditing = useCallback(() => setEditing(false), [])

  useEffect(() => {
    if (!editing) return
    const handler = (e: MouseEvent) => {
      const root = rootRef.current
      if (!root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      setEditing(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editing])

  if (editing) {
    return (
      <div ref={rootRef} className="studio-doc-block studio-doc-block--editing">
        <div className="studio-doc-block-editing-toolbar">
          <button type="button" className="studio-doc-done-btn" onClick={stopEditing}>
            Done
          </button>
        </div>
        <InlineBlockRenderer block={block} onChange={onChange} />
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="studio-doc-block"
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setEditing(true)
        }
      }}
    >
      <DocView block={block} />
    </div>
  )
}

function DocView({ block }: { block: ContentBlock }) {
  if (block.type === 'rich_text') {
    return <RichTextDocView block={block} placeholder="Empty paragraph — click to edit" />
  }
  if (block.type === 'question_select' || block.type === 'question_free_response') {
    return <QuestionDocView block={block} />
  }
  if (block.type === 'latex') {
    return <LatexDocView block={block} />
  }
  if (block.type === 'svg') {
    return <SvgDocView block={block} />
  }
  if (block.type === 'question_axis') {
    return <AxisDocView block={block} />
  }
  if (block.type === 'question_geometry') {
    return <GeometryDocView block={block} />
  }
  if (block.type === 'question_multi_axis') {
    return <MultiAxisDocView block={block} />
  }
  return <UnsupportedDocView block={block} />
}

function UnsupportedDocView({ block }: { block: ContentBlock }) {
  const label = describeBlock(block)
  return (
    <div className="studio-doc-unsupported">
      <span className="studio-doc-unsupported-badge">{label}</span>
      <span className="studio-doc-unsupported-hint">Click to edit</span>
    </div>
  )
}

function describeBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'question_table':
      return 'Table question'
    case 'question_matching':
      return 'Matching question'
    case 'html':
      return 'HTML block'
    case 'media':
      return 'Media'
    default:
      return block.type
  }
}
