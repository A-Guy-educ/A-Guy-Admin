import React from 'react'
import type { QuestionAxisBlock } from '@/server/payload/collections/Exercises/types'
import { AxisRenderer } from '@/ui/shared/exerciserenderer/blocks/AxisRenderer'
import { RichTextDocView } from './RichTextDocView'

interface AxisDocViewProps {
  block: QuestionAxisBlock
}

/**
 * Read-only preview of an axis question: prompt above, live JSXGraph render
 * below. The graph gets `pointer-events: none` in CSS so clicks fall through
 * to the studio's click-to-edit wrapper.
 */
export const AxisDocView: React.FC<AxisDocViewProps> = ({ block }) => {
  return (
    <div className="studio-doc-question studio-doc-graph">
      <div className="studio-doc-question-prompt">
        <RichTextDocView block={block.prompt} placeholder="Untitled axis question" />
      </div>
      <div className="studio-doc-graph-canvas">
        <AxisRenderer blockId={block.id} spec={block.axis} displaySize={block.displaySize} />
      </div>
    </div>
  )
}
