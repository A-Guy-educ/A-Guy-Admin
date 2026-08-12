import React from 'react'
import type { QuestionMultiAxisBlock } from '@/server/payload/collections/Exercises/types'
import { MultiAxisRenderer } from '@/ui/shared/exerciserenderer/blocks/MultiAxisRenderer'

interface MultiAxisDocViewProps {
  block: QuestionMultiAxisBlock
}

export const MultiAxisDocView: React.FC<MultiAxisDocViewProps> = ({ block }) => {
  const prompt = block.prompt
    ? {
        type: 'rich_text' as const,
        format: 'md-math-v1' as const,
        value: block.prompt.value,
        mediaIds: block.prompt.mediaIds ?? [],
      }
    : undefined

  return (
    <div className="studio-doc-question studio-doc-graph">
      <MultiAxisRenderer
        blockId={block.id}
        graphs={block.graphs}
        prompt={prompt}
        textPosition={block.textPosition}
        columnsPerRow={block.columnsPerRow}
      />
    </div>
  )
}
