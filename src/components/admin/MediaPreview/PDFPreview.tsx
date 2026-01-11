'use client'

import dynamic from 'next/dynamic'
import React from 'react'

// Import with ssr: false to prevent server-side rendering
const PDFPreviewClient = dynamic(
  () =>
    import('./PDFPreview.client').then((mod) => ({
      default: mod.PDFPreviewClient,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Loading PDF viewer...</div>
      </div>
    ),
  },
)

export const PDFPreview: React.FC = () => {
  return <PDFPreviewClient />
}
