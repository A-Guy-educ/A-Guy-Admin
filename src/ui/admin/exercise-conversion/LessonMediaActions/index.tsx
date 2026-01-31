'use client'

import { ConvertForm } from '@/ui/admin/exercise-conversion/ConvertForm'
import { useAuth } from '@payloadcms/ui'
import React from 'react'

interface LessonMediaActionsProps {
  media: {
    id: string
    filename: string
    mimeType: string
    filesize?: number
  }
  lessonId: string
}

export function LessonMediaActions({ media, lessonId }: LessonMediaActionsProps) {
  const { user } = useAuth()
  const isAdmin = user?.roles?.includes('admin')
  const isPdf = media.mimeType === 'application/pdf'

  if (!isAdmin || !isPdf) {
    return null
  }

  return (
    <div className="lesson-media-actions">
      <ConvertButton lessonId={lessonId} mediaId={media.id} filename={media.filename} />
    </div>
  )
}

function ConvertButton({
  lessonId,
  mediaId,
  filename,
}: {
  lessonId: string
  mediaId: string
  filename: string
}) {
  const [isFormOpen, setIsFormOpen] = React.useState(false)

  return (
    <>
      <button
        className="btn btn-secondary"
        onClick={() => setIsFormOpen(true)}
        style={{
          padding: '4px 12px',
          fontSize: 11,
          fontWeight: 500,
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: 3,
          backgroundColor: 'var(--theme-elevation-100)',
          color: 'var(--theme-elevation-700)',
          cursor: 'pointer',
        }}
      >
        Convert → Exercises
      </button>

      {isFormOpen && (
        <div
          style={{
            marginTop: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: 4,
            }}
          >
            <button
              onClick={() => setIsFormOpen(false)}
              style={{
                padding: '2px 8px',
                fontSize: 10,
                background: 'none',
                border: 'none',
                color: 'var(--theme-elevation-500)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
          <ConvertForm
            lessonId={lessonId}
            mediaId={mediaId}
            filename={filename}
            onClose={() => setIsFormOpen(false)}
          />
        </div>
      )}
    </>
  )
}
