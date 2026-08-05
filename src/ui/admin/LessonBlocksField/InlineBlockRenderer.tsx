'use client'

import React from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { InlineRichTextEditor } from '../ExerciseContentEditor/editors/InlineRichTextEditor'
import { TrueFalseEditor } from '../ExerciseContentEditor/editors/TrueFalseEditor'
import { McqEditor } from '../ExerciseContentEditor/editors/McqEditor'
import { FreeResponseEditor } from '../ExerciseContentEditor/editors/FreeResponseEditor'
import { TableEditor } from '../ExerciseContentEditor/editors/TableEditor'
import { MatchingEditor } from '../ExerciseContentEditor/editors/MatchingEditor'
import { SvgEditor } from '../ExerciseContentEditor/editors/SvgEditor'
import { HtmlBlockEditor } from '../ExerciseContentEditor/editors/HtmlBlockEditor'
import { MediaBlockEditor } from '../ExerciseContentEditor/editors/MediaBlockEditor'

function getBlockTypeLabel(block: ContentBlock): string {
  const variant = (block as { variant?: string }).variant
  if (block.type === 'question_select' && variant === 'true_false') return 'True / False'
  if (block.type === 'question_select' && variant === 'mcq') return 'Multiple Choice'
  if (block.type === 'question_free_response') return 'Free Response'
  if (block.type === 'question_table') return 'Table Question'
  if (block.type === 'html') return 'HTML Block'
  if (block.type === 'question_matching') return 'Matching'
  if (block.type === 'svg') return 'SVG Image'
  if (block.type === 'media') return 'Media'
  if (block.type === 'latex') return 'LaTeX'
  if (block.type === 'question_geometry') return 'Geometry'
  if (block.type === 'question_axis') return 'Axis Graph'
  if (block.type === 'question_multi_axis') return 'Multi Axis Graph'
  return block.type
}

// Lazy-load geometry/axis editors to avoid bundle bloat.
const DynamicGraphBlock = React.lazy(() =>
  import('../ExerciseContentEditor/editors/GeometryEditor').then((m) => ({
    default: ({
      block,
      onChange,
    }: {
      block: ContentBlock
      onChange: (b: ContentBlock) => void
    }) => (
      <m.GeometryEditor
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GeometryEditor expects narrowed block type
        block={block as any}
        onChange={(updated: ContentBlock) => onChange(updated)}
      />
    ),
  })),
)

export const InlineBlockRenderer: React.FC<{
  block: ContentBlock
  onChange: (updated: ContentBlock) => void
}> = ({ block, onChange }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose dispatch to per-type editor components
  const b = block as any

  if (block.type === 'rich_text') {
    return (
      <div className="block-card">
        <div className="block-card-header">
          <div className="block-card-title">Rich Text</div>
        </div>
        <div className="block-card-content">
          <InlineRichTextEditor value={b} onChange={(val) => onChange({ ...b, ...val })} />
        </div>
      </div>
    )
  }

  if (block.type === 'question_select' && b.variant === 'true_false') {
    return (
      <div className="question-block-wrapper">
        <TrueFalseEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (block.type === 'question_select' && b.variant === 'mcq') {
    return (
      <div className="question-block-wrapper">
        <McqEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (block.type === 'question_free_response') {
    return (
      <div className="question-block-wrapper">
        <FreeResponseEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (block.type === 'question_table') {
    return (
      <div className="question-block-wrapper">
        <TableEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (block.type === 'question_matching') {
    return (
      <div className="question-block-wrapper">
        <MatchingEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (block.type === 'svg') {
    return (
      <div className="question-block-wrapper">
        <SvgEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (block.type === 'html') {
    return (
      <div className="question-block-wrapper">
        <HtmlBlockEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (block.type === 'media') {
    return (
      <div className="question-block-wrapper">
        <MediaBlockEditor block={b} onChange={(updated) => onChange(updated)} />
      </div>
    )
  }

  if (
    block.type === 'question_geometry' ||
    block.type === 'question_axis' ||
    block.type === 'question_multi_axis'
  ) {
    return (
      <div className="question-block-wrapper">
        <DynamicGraphBlock block={block} onChange={onChange} />
      </div>
    )
  }

  return (
    <div className="block-card">
      <div className="block-card-header">
        <div className="block-card-title">{getBlockTypeLabel(block)}</div>
      </div>
      <div className="block-card-content">
        <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(block, null, 2)}</pre>
      </div>
    </div>
  )
}
