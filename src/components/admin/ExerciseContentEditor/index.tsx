'use client'

import React from 'react'
import { useField } from '@payloadcms/ui'
import { BlockList } from './BlockList'
import './index.css'

const DEFAULT_STEM = [
  {
    id: 'default-block-1',
    type: 'rich_text',
    format: 'md-math-v1',
    value: '# Write your question here\n\nExample: Solve for $x$: $2x+3=11$',
  },
]

export const ExerciseContentEditor: React.FC<{ path: string }> = ({ path }) => {
  const { value, setValue } = useField<any>({ path })

  // Ensure valid structure on load
  React.useEffect(() => {
    if (!value || !value.stem || !Array.isArray(value.stem)) {
      setValue({
        contentSchemaVersion: 1,
        stem: DEFAULT_STEM,
      })
    }
  }, [value, setValue])

  const handleUpdate = (newStem: any[]) => {
    // Validation is now lenient and allows intermediate states during editing
    // (add, remove, reorder, edit operations won't trigger validation errors)
    setValue({
      ...value,
      stem: newStem,
    })
  }

  if (!value || !value.stem) {
    return <div className="p-4 text-muted-foreground">Loading editor...</div>
  }

  return (
    <div className="exercise-content-editor">
      <div className="editor-header">
        <div>
          <h3>Exercise Content</h3>
          <p className="editor-description">
            Add and arrange content blocks. Supports Markdown and LaTeX math.
          </p>
        </div>
        <div className="editor-badge">Blocks V1</div>
      </div>

      <BlockList blocks={value.stem} onChange={handleUpdate} />
    </div>
  )
}
