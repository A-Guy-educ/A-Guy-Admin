import type { ExerciseBlock, RichTextBlock, SectionBlock } from '@/contracts'

export type EditorBlock = ExerciseBlock & {
  // Add temporary editor-only state here if needed
  _editorId?: string
  _error?: string
}

export type UnsupportedBlock = {
  type: string
  id: string
  [key: string]: any
}

export interface EditorState {
  blocks: EditorBlock[]
  selectedBlockId: string | null
  errors: string[] // Path strings or messages
}

export type EditorAction =
  | { type: 'SET_BLOCKS'; payload: EditorBlock[] }
  | { type: 'SELECT_BLOCK'; payload: string | null }
  | {
      type: 'ADD_BLOCK'
      payload: { parentId?: string; type: 'rich_text' | 'section'; index?: number }
    }
  | { type: 'UPDATE_BLOCK'; payload: { id: string; updates: Partial<EditorBlock> } }
  | { type: 'DELETE_BLOCK'; payload: string }
  | { type: 'MOVE_BLOCK'; payload: { id: string; direction: 'up' | 'down' } }
