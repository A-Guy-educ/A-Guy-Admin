'use client'

/**
 * StudioLauncherButton — admin action that opens the Lesson Studio for the
 * current lesson doc. Registered on Lessons.admin.components.edit.beforeDocumentControls.
 */
import React from 'react'
import Link from 'next/link'
import { useDocumentInfo } from '@payloadcms/ui'

import './lesson-studio.css'

export const StudioLauncherAction: React.FC = () => {
  const { id } = useDocumentInfo()
  if (!id) return null

  return (
    <Link
      href={`/admin/studio/lessons/${id}`}
      className="studio-launcher-button"
      title="Open this lesson in the Studio to edit all exercises/sections on one page"
    >
      Open in Studio
    </Link>
  )
}
