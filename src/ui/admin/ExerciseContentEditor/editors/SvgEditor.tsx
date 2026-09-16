'use client'

import React from 'react'
import type { SvgBlock } from '@/server/payload/collections/Exercises/types'
import { SvgContentEditor } from './SvgContentEditor'

interface SvgEditorProps {
  block: SvgBlock
  onChange: (block: SvgBlock) => void
}

export const SvgEditor: React.FC<SvgEditorProps> = ({ block, onChange }) => {
  // The child SvgContentEditor can fire onChange asynchronously from
  // FileReader.onload. Reading `block` from a ref keeps sibling fields
  // (hint / solution / hotspots) safe if the user edits them mid-upload.
  const blockRef = React.useRef(block)
  React.useEffect(() => {
    blockRef.current = block
  }, [block])

  return (
    <div className="svg-editor">
      <SvgContentEditor
        content={{ value: block.value, altText: block.altText, caption: block.caption }}
        onChange={(content) =>
          onChange({
            ...blockRef.current,
            value: content.value,
            altText: content.altText,
            caption: content.caption,
          })
        }
      />
    </div>
  )
}
