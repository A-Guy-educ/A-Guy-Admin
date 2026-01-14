'use client'

import React from 'react'
import { useFormFields } from '@payloadcms/ui'

export const PDFPreviewClient: React.FC = () => {
  const urlField = useFormFields(([fields]) => fields.url)
  const url = urlField?.value as string | undefined

  if (!url) {
    return (
      <div className="p-4">
        <p>No PDF uploaded yet</p>
      </div>
    )
  }

  // Load PDF.js viewer via proxy (Blob CDN sets Content-Disposition: attachment)
  // Add version parameter to bust cache when viewer files are updated
  const viewerUrl = `/api/pdfjs-viewer?file=${encodeURIComponent(url)}&v=4.4.168`

  return (
    <div className="p-4">
      <iframe src={viewerUrl} className="w-full h-[500px] border rounded-lg" title="PDF Preview" />
    </div>
  )
}
