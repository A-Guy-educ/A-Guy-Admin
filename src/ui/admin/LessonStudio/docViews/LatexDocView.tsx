import React from 'react'
import type { LatexBlock } from '@/server/payload/collections/Exercises/types'
import { LatexBlockRenderer } from '@/ui/shared/exerciserenderer/blocks/LatexBlockRenderer'

interface LatexDocViewProps {
  block: LatexBlock
}

/**
 * Read-only LaTeX preview using the runtime `LatexBlockRenderer`. Wraps in a
 * container that stays clickable for the studio's click-to-edit affordance.
 */
export const LatexDocView: React.FC<LatexDocViewProps> = ({ block }) => {
  if (!block.latex || block.latex.trim() === '') {
    return <span className="studio-doc-placeholder">Empty LaTeX — click to edit</span>
  }
  return (
    <div className="studio-doc-latex">
      <LatexBlockRenderer block={block} />
    </div>
  )
}
