'use client'

import React from 'react'
import { useField } from '@payloadcms/ui'
import { EditorProvider, useEditor } from './EditorStore'
import { BlockTree } from './BlockTree'
import { PropertiesPanel } from './PropertiesPanel'
import { EditorBlock } from './types'
import './index.css'

const EditorLayout: React.FC = () => {
  return (
    <div className="flex w-full h-[75vh] min-h-[500px] border border-border rounded-lg shadow-sm overflow-hidden bg-background">
      {/* Left Sidebar: Block Tree */}
      <div className="w-[320px] shrink-0 border-r border-border bg-slate-50/50 dark:bg-slate-950/30 flex flex-col">
        <BlockTree />
      </div>

      {/* Right Panel: Properties */}
      <div className="flex-1 min-w-0 bg-background flex flex-col">
        <PropertiesPanel />
      </div>
    </div>
  )
}

const DataSync: React.FC<{ setValue: (val: any) => void; originalValue: any }> = ({
  setValue,
  originalValue,
}) => {
  const { state } = useEditor()

  // Sync to Payload on change
  React.useEffect(() => {
    const currentStemStr = JSON.stringify(state.blocks)
    const valueStemStr = JSON.stringify(originalValue?.stem || [])

    if (currentStemStr !== valueStemStr) {
      const newValue = {
        contentSchemaVersion: 1,
        ...originalValue,
        stem: state.blocks,
      }
      setValue(newValue)
    }
  }, [state.blocks, setValue, originalValue])

  return null
}

export const ExerciseContentEditor: React.FC<{ path: string }> = ({ path }) => {
  const { value, setValue } = useField<any>({ path })

  // Initial state logic
  const initialStem: EditorBlock[] = React.useMemo(() => {
    if (value && value.stem && Array.isArray(value.stem)) {
      return value.stem
    }
    return []
  }, []) // Depend on empty array to only run once?
  // Actually value might be loaded async? useField handles that.
  // But strictly we want to initialize store once.
  // If we change initialStem later (e.g. remote update), does store update?
  // The EditorProvider initializes state once.

  // Safety: Ensure we don't crash if value is malformed strings (Payload sometimes passes stringified JSON?)
  // Assuming type: 'json' field returns object in Payload 3.

  return (
    <div className="exercise-content-editor">
      <label className="field-label">Content Editor (v2)</label>

      <EditorProvider
        initialBlocks={initialStem}
        onChange={(blocks) => {
          /* handled by inner sync */
        }}
      >
        <EditorLayout />
        <DataSync setValue={setValue} originalValue={value} />
      </EditorProvider>
    </div>
  )
}
