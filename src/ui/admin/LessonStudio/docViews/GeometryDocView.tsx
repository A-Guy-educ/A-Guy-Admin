import React from 'react'
import type { QuestionGeometryBlock } from '@/server/payload/collections/Exercises/types'
import { GeometryRenderer } from '@/ui/shared/exerciserenderer/blocks/GeometryRenderer'
import { RichTextDocView } from './RichTextDocView'

interface GeometryDocViewProps {
  block: QuestionGeometryBlock
}

export const GeometryDocView: React.FC<GeometryDocViewProps> = ({ block }) => {
  return (
    <div className="studio-doc-question studio-doc-graph">
      <div className="studio-doc-question-prompt">
        <RichTextDocView block={block.prompt} placeholder="Untitled geometry question" />
      </div>
      <div className="studio-doc-graph-canvas">
        <GeometryRenderer blockId={block.id} spec={block.geometry} />
      </div>
    </div>
  )
}
