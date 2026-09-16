'use client'

import React from 'react'
import type { SvgBlock } from '@/server/payload/collections/Exercises/types'
import { SvgContentEditor } from './SvgContentEditor'

interface SvgEditorProps {
  block: SvgBlock
  onChange: (block: SvgBlock) => void
}

export const SvgEditor: React.FC<SvgEditorProps> = ({ block, onChange }) => {
  return (
    <div className="svg-editor">
      <SvgContentEditor
        content={{ value: block.value, altText: block.altText, caption: block.caption }}
        onChange={(content) =>
          onChange({
            ...block,
            value: content.value,
            altText: content.altText,
            caption: content.caption,
          })
        }
      />
    </div>
  )
}
