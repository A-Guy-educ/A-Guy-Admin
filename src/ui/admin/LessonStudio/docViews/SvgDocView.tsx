import React from 'react'
import type { SvgBlock } from '@/server/payload/collections/Exercises/types'
import { SvgRenderer } from '@/ui/shared/exerciserenderer/blocks/SvgRenderer'

interface SvgDocViewProps {
  block: SvgBlock
}

/**
 * Read-only SVG preview. Hotspot props are intentionally omitted so the SVG
 * renders as a static image even when the underlying block has
 * `interactive: true` — this is authoring preview, not runtime.
 */
export const SvgDocView: React.FC<SvgDocViewProps> = ({ block }) => {
  if (!block.value || block.value.trim() === '') {
    return <span className="studio-doc-placeholder">Empty SVG — click to edit</span>
  }
  return (
    <div className="studio-doc-svg">
      <SvgRenderer block={block} disabled />
    </div>
  )
}
