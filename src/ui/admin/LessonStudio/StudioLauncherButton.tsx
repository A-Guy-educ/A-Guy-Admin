'use client'

/**
 * StudioLauncherButton — admin action that opens the Lesson Studio for the
 * current lesson doc. Registered on Lessons.admin.components.edit.beforeDocumentControls.
 */
import React from 'react'
import Link from 'next/link'
import { useDocumentInfo } from '@payloadcms/ui'

export const StudioLauncherAction: React.FC = () => {
  const { id } = useDocumentInfo()
  if (!id) return null

  return (
    <Link
      href={`/admin/studio/lessons/${id}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 500,
        border: '1px solid var(--theme-success-500, #22c55e)',
        borderRadius: 4,
        backgroundColor: 'var(--theme-success-500, #22c55e)',
        color: 'white',
        textDecoration: 'none',
      }}
      title="Open this lesson in the Studio to edit all exercises/sections on one page"
    >
      Open in Studio
    </Link>
  )
}
