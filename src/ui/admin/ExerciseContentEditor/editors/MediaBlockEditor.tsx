'use client'

import type { MediaBlock } from '@/server/payload/collections/Exercises/types'
import { useTranslation } from '@payloadcms/ui'
import Image from 'next/image'
import React from 'react'
import { Film, Trash2, Upload } from 'lucide-react'

interface MediaBlockEditorProps {
  block: MediaBlock
  onChange: (block: MediaBlock) => void
  onOpenMediaPicker: () => void
}

export const MediaBlockEditor: React.FC<MediaBlockEditorProps> = ({
  block,
  onChange,
  onOpenMediaPicker,
}) => {
  const { t: _t } = useTranslation()
  const [media, setMedia] = React.useState<{
    id: string
    url: string
    alt: string
    filename: string
  } | null>(null)
  const [loading, setLoading] = React.useState(false)

  // Fetch media details when mediaId changes
  React.useEffect(() => {
    if (!block.mediaId) {
      setMedia(null)
      return
    }

    const fetchMedia = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/media/${block.mediaId}`)
        if (response.ok) {
          const data = await response.json()
          setMedia({
            id: data.doc.id,
            url: data.doc.url,
            alt: data.doc.alt || '',
            filename: data.doc.filename,
          })
        } else {
          setMedia(null)
        }
      } catch {
        setMedia(null)
      } finally {
        setLoading(false)
      }
    }

    fetchMedia()
  }, [block.mediaId])

  const handleSelectMedia = () => {
    onOpenMediaPicker()
  }

  const handleRemoveMedia = () => {
    onChange({ ...block, mediaId: '' })
  }

  return (
    <div className="media-block-editor">
      <div className="media-block-editor-header">
        <span className="media-block-editor-label">Media</span>
      </div>

      {loading ? (
        <div className="media-block-editor-loading">Loading media...</div>
      ) : media ? (
        <div className="media-block-editor-preview">
          <div className="media-block-editor-image-container">
            <Image
              src={media.url}
              alt={media.alt || media.filename}
              width={200}
              height={200}
              className="media-block-editor-image"
              style={{ objectFit: 'contain' }}
            />
          </div>
          <div className="media-block-editor-info">
            <span className="media-block-editor-filename">{media.filename}</span>
          </div>
          <div className="media-block-editor-actions">
            <button
              type="button"
              className="media-block-editor-action-btn"
              onClick={handleSelectMedia}
            >
              <Upload size={14} />
              <span>Change</span>
            </button>
            <button
              type="button"
              className="media-block-editor-action-btn media-block-editor-action-btn--danger"
              onClick={handleRemoveMedia}
            >
              <Trash2 size={14} />
              <span>Remove</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="media-block-editor-empty">
          <Film size={48} className="media-block-editor-empty-icon" />
          <p>No media selected</p>
          <button
            type="button"
            className="media-block-editor-select-btn"
            onClick={handleSelectMedia}
          >
            <Upload size={16} />
            <span>Select Media</span>
          </button>
        </div>
      )}
    </div>
  )
}
