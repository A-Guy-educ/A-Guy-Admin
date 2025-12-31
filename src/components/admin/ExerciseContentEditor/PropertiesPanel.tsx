// Imports
import React from 'react'
import { useEditor } from './EditorStore'
import { EditorBlock } from './types'
import { MousePointerClick, Type, Folder, Info } from 'lucide-react'
import { FieldLabel } from '@payloadcms/ui'
import { SectionBlock, RichTextBlock } from '@/contracts'

export const PropertiesPanel: React.FC = () => {
  const { state, dispatch } = useEditor()
  const { selectedBlockId, blocks } = state

  // Helper to find selected block recursively
  const findSelected = (list: EditorBlock[]): EditorBlock | null => {
    for (const b of list) {
      if (b.id === selectedBlockId) return b
      if (b.type === 'section') {
        // Cast to SectionBlock to access 'blocks' safely
        const section = b as unknown as SectionBlock
        if (section.blocks) {
          const found = findSelected(section.blocks as unknown as EditorBlock[])
          if (found) return found
        }
      }
    }
    return null
  }

  const selectedBlock = selectedBlockId ? findSelected(blocks) : null

  if (!selectedBlock) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm p-8 text-center bg-slate-50/50 dark:bg-slate-900/10">
        <MousePointerClick size={48} className="mb-4 text-muted-foreground/20" />
        <h3 className="text-lg font-medium text-foreground mb-2">No Block Selected</h3>
        <p className="max-w-xs mx-auto text-muted-foreground/80">
          Select a block from the content tree on the left to edit its properties here.
        </p>
      </div>
    )
  }

  const handleChange = (updates: Partial<EditorBlock>) => {
    dispatch({ type: 'UPDATE_BLOCK', payload: { id: selectedBlock.id, updates } })
  }

  const isRichText = selectedBlock.type === 'rich_text'
  const isSection = selectedBlock.type === 'section'

  // Safe casting
  const richTextBlock = isRichText ? (selectedBlock as unknown as RichTextBlock) : null
  const sectionBlock = isSection ? (selectedBlock as unknown as SectionBlock) : null

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 h-[52px] border-b border-border shrink-0 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div
          className={`p-1.5 rounded-md ${isSection ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'}`}
        >
          {isSection ? <Folder size={16} /> : <Type size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm tracking-tight text-foreground truncate">
            {isSection ? 'Section Properties' : 'Rich Text Properties'}
          </h3>
          <p className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
            ID: <span className="select-all">{selectedBlock.id}</span>
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 overflow-y-auto flex-1 space-y-6">
        {isRichText && richTextBlock && (
          <div className="group space-y-2">
            <div className="flex justify-between items-baseline">
              <FieldLabel label="Content" />
              <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                md-math-v1
              </span>
            </div>

            <div className="relative">
              <textarea
                className="w-full h-[400px] p-4 rounded-lg border border-input bg-background/50 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y shadow-sm"
                value={richTextBlock.value || ''}
                onChange={(e) => handleChange({ value: e.target.value })}
                placeholder={`# Heading\n\nEnter your content here...\n\n$E = mc^2$`}
              />
              <div className="absolute bottom-2 right-2 opacity-50 text-[10px] bg-background/80 px-2 py-0.5 rounded border border-border shadow-sm pointer-events-none">
                Markdown + Math
              </div>
            </div>

            <div className="text-xs text-muted-foreground flex gap-2 items-start mt-2 p-3 bg-blue-50/50 dark:bg-blue-900/10 rounded border border-blue-100 dark:border-blue-900/20 text-blue-700 dark:text-blue-300">
              <Info size={14} className="mt-0.5 shrink-0" />
              <p>
                Use standard Markdown for formatting. Math equations are supported using LaTeX
                syntax enclosed in <code>$</code> signs (e.g. <code>$x^2$</code>).
              </p>
            </div>
          </div>
        )}

        {isSection && sectionBlock && (
          <div className="space-y-6">
            <div className="space-y-3">
              <FieldLabel label="Section Label" />
              <input
                type="text"
                className="w-full p-2.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                value={sectionBlock.label || ''}
                onChange={(e) => handleChange({ label: e.target.value })}
                placeholder="e.g. Part A, Q1, etc."
              />
              <p className="text-xs text-muted-foreground">
                Short identifier (e.g., &quot;Part A&quot;). Used in navigation and references.
              </p>
            </div>

            <div className="space-y-3">
              <FieldLabel label="Display Title" />
              <input
                type="text"
                className="w-full p-2.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                value={sectionBlock.title || ''}
                onChange={(e) => handleChange({ title: e.target.value })}
                placeholder="Optional descriptive title"
              />
              <p className="text-xs text-muted-foreground">
                Optional longer title shown to students.
              </p>
            </div>

            <div className="pt-4 border-t border-border mt-4">
              <p className="text-sm font-medium mb-2">Structure</p>
              <p className="text-xs text-muted-foreground">
                This section contains <strong>{sectionBlock.blocks?.length || 0}</strong> nested
                blocks. Use the &quot;Block Structure&quot; tree on the left to add, move, or remove
                items from this section.
              </p>
            </div>
          </div>
        )}

        {!isRichText && !isSection && (
          <div className="p-4 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900 rounded-md text-orange-800 dark:text-orange-200 text-sm">
            <strong className="flex items-center gap-2 mb-2">Unsupported Block Type</strong>
            <p>
              This block type <code>{selectedBlock.type}</code> is not supported by this editor.
            </p>
            <div className="mt-3 p-3 bg-white dark:bg-black/20 rounded border border-orange-100 dark:border-orange-900/50 text-xs font-mono overflow-x-auto shadow-inner">
              {JSON.stringify(selectedBlock, null, 2)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
