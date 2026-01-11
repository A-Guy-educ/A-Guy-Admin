'use client'

import React from 'react'
import dynamic from 'next/dynamic'

import type { Props as MediaProps } from '../types'

// Import with ssr: false to prevent server-side rendering
const PDFRenderer = dynamic(() => import('./PDFRenderer').then((mod) => mod.PDFRenderer), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[841px] border rounded-lg bg-muted/30">
      <div className="text-muted-foreground">Loading PDF...</div>
    </div>
  ),
})

export const PDFMedia: React.FC<MediaProps> = (props) => {
  return <PDFRenderer {...props} />
}
