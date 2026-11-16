import React from 'react'
import type { HtmlBlock } from '@/server/payload/collections/Exercises/types'
import { HtmlBlockRenderer } from '@/ui/shared/exerciserenderer/blocks/HtmlBlockRenderer'

interface HtmlDocViewProps {
  block: HtmlBlock
}

/**
 * Read-only HTML preview. Pointer events are disabled via CSS so clicks
 * (including on full-document iframes) fall through to the block and open
 * the editor instead of interacting with the content.
 */
export const HtmlDocView: React.FC<HtmlDocViewProps> = ({ block }) => {
  if (!block.guidedExplanation && (!block.html || block.html.trim() === '')) {
    return <span className="studio-doc-placeholder">Empty HTML — click to edit</span>
  }
  return (
    <div className="studio-doc-html">
      <HtmlBlockRenderer block={block} />
    </div>
  )
}
