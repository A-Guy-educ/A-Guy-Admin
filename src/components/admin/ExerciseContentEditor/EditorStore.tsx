'use client'

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import type { EditorBlock, EditorState, EditorAction } from './types'
import { generateId } from './utils'
import type { ExerciseBlock, SectionBlock, RichTextBlock } from '@/contracts'

const INITIAL_STATE: EditorState = {
  blocks: [],
  selectedBlockId: null,
  errors: [],
}

const EditorContext = createContext<{
  state: EditorState
  dispatch: React.Dispatch<EditorAction>
} | null>(null)

// Helper to find block by ID and its parent path
const findBlock = (
  blocks: EditorBlock[],
  id: string,
  path: number[] = [],
  parents: EditorBlock[] = [],
): {
  block: EditorBlock
  index: number
  parent: EditorBlock | null
  parents: EditorBlock[]
  depth: number
} | null => {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.id === id) {
      return { block, index: i, parent: null, parents, depth: parents.length + 1 } // Depth is 1-based (Root items are level 1)
    }
    if (block.type === 'section' && (block as SectionBlock).blocks) {
      const result = findBlock(
        (block as SectionBlock).blocks,
        id,
        [...path, i],
        [...parents, block],
      )
      if (result) {
        return {
          ...result,
          parent: result.parent || block, // If it was null in recursive call, the immediate parent is this block
        }
      }
    }
  }
  return null
}

// Deep copy blocks
const deepClone = (blocks: EditorBlock[]): EditorBlock[] => JSON.parse(JSON.stringify(blocks))

export const editorReducer = (state: EditorState, action: EditorAction): EditorState => {
  switch (action.type) {
    case 'SET_BLOCKS':
      return { ...state, blocks: action.payload }

    case 'SELECT_BLOCK':
      return { ...state, selectedBlockId: action.payload }

    case 'ADD_BLOCK': {
      const { parentId, type, index } = action.payload
      const newBlock: EditorBlock =
        type === 'section'
          ? { id: generateId(), type: 'section', title: 'New Section', blocks: [] }
          : { id: generateId(), type: 'rich_text', format: 'md-math-v1', value: '' }

      const newBlocks = deepClone(state.blocks)

      if (!parentId) {
        // Add to root
        // Section allowed at Root (Level 1) -> contains L2
        // RichText allowed at Root
        const idx = typeof index === 'number' ? index : newBlocks.length
        newBlocks.splice(idx, 0, newBlock)
        return { ...state, blocks: newBlocks, selectedBlockId: newBlock.id }
      } else {
        const found = findBlock(newBlocks, parentId)
        if (found && found.block.type === 'section') {
          // Current depth of parent is found.depth.
          // Child will be at found.depth + 1.
          // Max depth 3. So parent depth must be < 3.
          // Exception: If adding a Section, child Section will contain items at depth+2.
          // Logic:
          // Root items: Depth 1.
          // If Parent is Depth 1: Child is Depth 2. (Section allowed, Leaf allowed)
          // If Parent is Depth 2: Child is Depth 3. (Leaf ONLY allowed)

          if (found.depth >= 3) {
            // Cannot add anything inside Level 3 (it shouldn't be a section anyway per schema, but safety check)
            console.warn('Cannot add items to depth > 2 container')
            return state
          }

          if (type === 'section' && found.depth >= 2) {
            // Cannot add Section inside Level 2 container (making it Level 3 Section, not allowed)
            console.warn('Cannot nest sections deeper than level 2')
            return state
          }

          const targetSection = found.block as SectionBlock
          // Ensure blocks array exists and is mutable
          if (!targetSection.blocks) targetSection.blocks = []
          const idx = typeof index === 'number' ? index : targetSection.blocks.length
          // Cast to any to avoid strict type mismatch with EditorBlock vs ExerciseBlock union
          targetSection.blocks.splice(idx, 0, newBlock as any)
          return { ...state, blocks: newBlocks, selectedBlockId: newBlock.id }
        }
      }
      return state
    }

    case 'UPDATE_BLOCK': {
      const newBlocks = deepClone(state.blocks)
      const found = findBlock(newBlocks, action.payload.id)
      if (found) {
        Object.assign(found.block, action.payload.updates)
        return { ...state, blocks: newBlocks }
      }
      return state
    }

    case 'DELETE_BLOCK': {
      const newBlocks = deepClone(state.blocks)
      const found = findBlock(newBlocks, action.payload)
      if (found) {
        if (found.parent) {
          const parentSection = found.parent as SectionBlock
          parentSection.blocks = parentSection.blocks.filter((b) => b.id !== action.payload)
        } else {
          // Remove from root
          const idx = newBlocks.findIndex((b) => b.id === action.payload)
          if (idx !== -1) newBlocks.splice(idx, 1)
        }
        return {
          ...state,
          blocks: newBlocks,
          selectedBlockId: state.selectedBlockId === action.payload ? null : state.selectedBlockId,
        }
      }
      return state
    }

    case 'MOVE_BLOCK': {
      const { id, direction } = action.payload
      const newBlocks = deepClone(state.blocks)
      const found = findBlock(newBlocks, id)

      if (found) {
        const list = found.parent ? (found.parent as SectionBlock).blocks : newBlocks
        const idx = found.index // Should verify this logic works with recursive 'findBlock'
        // Actually findBlock returns index relative to the container provided in 'findBlock' which is passed recursively.
        // But if I use deepClone, 'found' reference is from 'newBlocks'.
        // Wait, findBlock implementation above modifies 'parents'.
        // My findBlock returns { block } which is a reference if JS objects are references.
        // But I need the LIST to splice.
        // Let's rely on finding the parent again or use a pointer.

        // Correct approach:
        // Get the list reference
        let targetList: EditorBlock[]
        if (found.parent) {
          // We need to find the parent in 'newBlocks' (which is cloned)
          // 'found' was found in 'newBlocks' (passed to findBlock), so 'found.parent' IS the reference in 'newBlocks'
          targetList = (found.parent as SectionBlock).blocks
        } else {
          targetList = newBlocks
        }

        const currentIdx = targetList.findIndex((b) => b.id === id) // Safety find
        if (currentIdx === -1) return state

        const newIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1

        if (newIdx >= 0 && newIdx < targetList.length) {
          const [item] = targetList.splice(currentIdx, 1)
          targetList.splice(newIdx, 0, item)
          return { ...state, blocks: newBlocks }
        }
      }
      return state
    }

    default:
      return state
  }
}

export const EditorProvider: React.FC<{
  initialBlocks: EditorBlock[]
  children: React.ReactNode
  onChange: (blocks: EditorBlock[]) => void
}> = ({ initialBlocks, children, onChange }) => {
  const [state, dispatch] = useReducer(editorReducer, { ...INITIAL_STATE, blocks: initialBlocks })

  // Sync back to payload
  useEffect(() => {
    // Avoid infinite loop if onChange triggers re-render that updates initialBlocks
    // We assume onChange is stable or handled by parent field
    onChange(state.blocks)
  }, [state.blocks, onChange])

  return <EditorContext.Provider value={{ state, dispatch }}>{children}</EditorContext.Provider>
}

export const useEditor = () => {
  const context = useContext(EditorContext)
  if (!context) throw new Error('useEditor must be used within EditorProvider')
  return context
}
