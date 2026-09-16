import React from 'react'
import { Paperclip } from 'lucide-react'
import type { QuestionAttachment } from '@/server/payload/collections/Exercises/types'
import { AxisRenderer } from '@/ui/shared/exerciserenderer/blocks/AxisRenderer'
import { GeometryRenderer } from '@/ui/shared/exerciserenderer/blocks/GeometryRenderer'
import { SvgRenderer } from '@/ui/shared/exerciserenderer/blocks/SvgRenderer'
import { RichTextDocView } from './RichTextDocView'

interface AttachmentDocViewProps {
  /** ID of the host question block — used to give each attachment renderer a
   *  stable canvas ID even though the attachment itself has no id. */
  hostBlockId: string
  attachment: QuestionAttachment
}

/**
 * Read-only preview of a question's optional `attachment` sketch. Reuses the
 * same runtime renderers as the standalone `svg` / `question_geometry` /
 * `question_axis` blocks so what admins see here matches what students see.
 * A "Attached sketch" chip marks it as belonging to the parent question so
 * authors don't mistake it for a standalone block.
 */
export const AttachmentDocView: React.FC<AttachmentDocViewProps> = ({
  hostBlockId,
  attachment,
}) => {
  return (
    <div className="studio-doc-attachment">
      <div className="studio-doc-attachment-badge" aria-label="Attached sketch">
        <Paperclip size={12} aria-hidden="true" />
        <span>Attached sketch</span>
      </div>
      <div className="studio-doc-attachment-body">
        {renderAttachmentBody(hostBlockId, attachment)}
      </div>
    </div>
  )
}

function renderAttachmentBody(hostBlockId: string, attachment: QuestionAttachment) {
  if (attachment.kind === 'svg') {
    const { svg } = attachment
    if (!svg.value || svg.value.trim() === '') {
      return <span className="studio-doc-placeholder">Empty SVG attachment</span>
    }
    return (
      <>
        <div className="studio-doc-svg">
          <SvgRenderer
            block={{
              id: `${hostBlockId}-attachment`,
              type: 'svg',
              value: svg.value,
              altText: svg.altText,
              caption: svg.caption,
            }}
            displaySize={attachment.displaySize}
            disabled
          />
        </div>
        {svg.caption && svg.caption.value.trim() !== '' && (
          <div className="studio-doc-attachment-caption">
            <RichTextDocView block={svg.caption} />
          </div>
        )}
      </>
    )
  }
  if (attachment.kind === 'geometry') {
    return (
      <div className="studio-doc-graph-canvas">
        <GeometryRenderer
          blockId={`${hostBlockId}-attachment`}
          spec={attachment.geometry}
          displaySize={attachment.displaySize}
        />
      </div>
    )
  }
  return (
    <div className="studio-doc-graph-canvas">
      <AxisRenderer
        blockId={`${hostBlockId}-attachment`}
        spec={attachment.axis}
        displaySize={attachment.displaySize}
      />
    </div>
  )
}
