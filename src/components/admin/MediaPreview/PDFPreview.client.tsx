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

  const viewerUrl = `/pdfjs/viewer.html?file=${encodeURIComponent(url)}`

  return (
    <div className="p-4">
      <iframe
        src={viewerUrl}
        className="w-full h-[500px] border rounded-lg"
        title="PDF Preview"
      />
    </div>
  )
}
