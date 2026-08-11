import React from 'react'
import type { InlineRichText, RichTextBlock } from '@/server/payload/collections/Exercises/types'
import { RichTextRenderer } from '@/ui/shared/exerciserenderer/blocks/RichTextRenderer'

interface RichTextDocViewProps {
  /** Standalone rich_text block (has id) or inline rich_text (no id, used inside questions). */
  block: RichTextBlock | InlineRichText
  /** Placeholder shown when the block has no value. */
  placeholder?: string
}

/**
 * Word-style render of a rich-text block. Reuses the runtime `RichTextRenderer`
 * so what admins see here matches what students see on the web.
 */
export const RichTextDocView: React.FC<RichTextDocViewProps> = ({ block, placeholder }) => {
  if (!block.value || block.value.trim() === '') {
    return <span className="studio-doc-placeholder">{placeholder ?? 'Empty text'}</span>
  }
  return (
    <RichTextRenderer
      block={{
        type: 'rich_text',
        format: 'md-math-v1',
        value: block.value,
        mediaIds: block.mediaIds ?? [],
      }}
    />
  )
}
