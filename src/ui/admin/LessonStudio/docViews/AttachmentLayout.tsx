import React from 'react'
import type { GraphLayout } from '@/server/payload/collections/Exercises/types'

interface AttachmentLayoutProps {
  layout: GraphLayout
  question: React.ReactNode
  attachment: React.ReactNode
}

/**
 * Positions a question's prose next to its attached sketch per the block's
 * `layout` field. Mirrors the four-way split used by the standalone
 * `question_geometry` / `question_axis` blocks (textAbove / textBelow /
 * textLeft / textRight) so the doc-view preview matches what Web renders.
 */
export const AttachmentLayout: React.FC<AttachmentLayoutProps> = ({
  layout,
  question,
  attachment,
}) => {
  const modifier = `studio-doc-attachment-layout--${layout}`
  return (
    <div className={`studio-doc-attachment-layout ${modifier}`}>
      <div className="studio-doc-attachment-layout-text">{question}</div>
      <div className="studio-doc-attachment-layout-sketch">{attachment}</div>
    </div>
  )
}
