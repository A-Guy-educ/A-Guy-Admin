import React from 'react'
import { useEditor } from './EditorStore'
import { EditorBlock } from './types'
import {
  ChevronRight,
  ChevronDown,
  Type,
  Folder,
  FileQuestion,
  Trash2,
  ArrowUp,
  ArrowDown,
  Plus,
} from 'lucide-react'
import { SectionBlock } from '@/contracts'
import { Button } from '@payloadcms/ui'

// ... imports

const BlockItem: React.FC<{
  block: EditorBlock
  depth: number
  index: number
  isLast: boolean
}> = ({ block, depth, index, isLast }) => {
  const { state, dispatch } = useEditor()
  const isSelected = state.selectedBlockId === block.id
  const [isExpanded, setIsExpanded] = React.useState(true)

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'SELECT_BLOCK', payload: block.id })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this block?')) {
      dispatch({ type: 'DELETE_BLOCK', payload: block.id })
    }
  }

  const handleMove = (direction: 'up' | 'down') => (e: React.MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'MOVE_BLOCK', payload: { id: block.id, direction } })
  }

  const isSection = block.type === 'section'
  const isRichText = block.type === 'rich_text'
  const isUnsupported = !isSection && !isRichText

  // Safe cast for display
  const sectionBlock = isSection ? (block as unknown as SectionBlock) : null

  return (
    <div className="flex flex-col select-none relative">
      <div
        className={`
            group flex items-center gap-2 py-1.5 px-3 min-h-[36px]
            cursor-pointer transition-all duration-75 relative
            ${isSelected ? 'bg-primary/5 dark:bg-primary/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'}
        `}
        onClick={handleSelect}
      >
        {/* Active Indicator Line */}
        {isSelected && (
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r-sm" />
        )}

        {/* Expander / Icon */}
        <div className="flex items-center justify-center w-5 h-5 shrink-0 text-muted-foreground">
          {isSection ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(!isExpanded)
              }}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-1" />
          )}
        </div>

        {/* Icon Type */}
        <div className="shrink-0">
          {isSection && <Folder size={15} className="text-blue-500/80" />}
          {isRichText && <Type size={15} className="text-emerald-600/80" />}
          {isUnsupported && <FileQuestion size={15} className="text-orange-500/80" />}
        </div>

        {/* Label */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span
            className={`text-sm leading-tight truncate ${isSelected ? 'font-medium text-foreground' : 'text-foreground/90'}`}
          >
            {isSection
              ? sectionBlock?.label ||
                sectionBlock?.title || <span className="italic opacity-50">Untitled Section</span>
              : 'Rich Text'}
            {isUnsupported && <span className="text-xs ml-2 opacity-70">({block.type})</span>}
          </span>
        </div>

        {/* ID - Visible on hover or selected */}
        <span
          className={`text-[10px] font-mono text-muted-foreground mr-1 ${isSelected || 'group-hover:opacity-100 opacity-0'} transition-opacity`}
        >
          {block.id.slice(0, 4)}
        </span>

        {/* Actions - Visible on hover only */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleMove('up')}
            disabled={index === 0}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-background/80 rounded disabled:opacity-0"
            title="Move Up"
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={handleMove('down')}
            disabled={isLast}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-background/80 rounded disabled:opacity-0"
            title="Move Down"
          >
            <ArrowDown size={12} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 rounded ml-1"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Children Container using Padding Indent instead of Margin + Border to prevent overflow issues in tight spaces, 
          but visual lines are nice. Let's strictly use nested padding. */}
      {isSection && isExpanded && sectionBlock?.blocks && (
        <div className="flex flex-col border-l border-border/40 ml-[19px] pl-1 relative">
          {/* The border-l creates the tree line guide. ml aligned to icon center roughly (12px padding + 10px half icon?) */}
          {sectionBlock.blocks.map((child, i) => (
            <BlockItem
              key={child.id}
              block={child as unknown as EditorBlock}
              depth={depth + 1}
              index={i}
              isLast={i === sectionBlock.blocks.length - 1}
            />
          ))}
          {/* Inline Add Buttons */}
          {depth < 3 && (
            <div className="flex items-center gap-2 pl-3 py-2 opacity-0 hover:opacity-100 transition-opacity group/add -ml-1">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider opacity-50 select-none">
                Add to {sectionBlock.label || 'Section'}:
              </span>
              <button
                className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-foreground px-2 py-0.5 rounded border border-border/50 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({
                    type: 'ADD_BLOCK',
                    payload: { parentId: block.id, type: 'rich_text' },
                  })
                }}
              >
                <Plus size={10} /> Text
              </button>
              {depth < 2 && (
                <button
                  className="flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-foreground px-2 py-0.5 rounded border border-border/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({
                      type: 'ADD_BLOCK',
                      payload: { parentId: block.id, type: 'section' },
                    })
                  }}
                >
                  <Plus size={10} /> Section
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const BlockTree: React.FC = () => {
  const { state, dispatch } = useEditor()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-border bg-background/50 backdrop-blur-sm sticky top-0 z-20 flex justify-between items-center h-[52px]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm tracking-tight text-foreground">Content Tree</span>
          <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-muted-foreground border border-border/50">
            {state.blocks.length}
          </span>
        </div>
        <div className="flex gap-1.5">
          {/* Small Iconic Buttons or standard small buttons */}
          <Button
            size="small"
            buttonStyle="secondary"
            className="!text-[11px] !h-7 !px-2.5 shadow-sm"
            onClick={() => dispatch({ type: 'ADD_BLOCK', payload: { type: 'rich_text' } })}
          >
            <Plus size={12} className="mr-1" /> Text
          </Button>
          <Button
            size="small"
            buttonStyle="secondary"
            className="!text-[11px] !h-7 !px-2.5 shadow-sm"
            onClick={() => dispatch({ type: 'ADD_BLOCK', payload: { type: 'section' } })}
          >
            <Plus size={12} className="mr-1" /> Section
          </Button>
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-muted-foreground/20">
        {state.blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm border-2 border-dashed border-border/50 rounded-lg m-2 bg-slate-50/50 dark:bg-slate-900/20">
            <Folder size={32} className="mb-2 opacity-20" />
            <p className="font-medium">Empty Exercise</p>
            <p className="text-xs opacity-70">Add a block to begin</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {state.blocks.map((block, i) => (
              <BlockItem
                key={block.id}
                block={block}
                depth={0} // Root is 0 now for calmer indent
                index={i}
                isLast={i === state.blocks.length - 1}
              />
            ))}
          </div>
        )}
        <div className="h-20" /> {/* Scroll pad */}
      </div>
    </div>
  )
}
