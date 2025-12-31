import { describe, it, expect } from 'vitest'
import { editorReducer } from '@/components/admin/ExerciseContentEditor/EditorStore'
import { EditorState, EditorBlock } from '@/components/admin/ExerciseContentEditor/types'

const INITIAL_STATE: EditorState = {
  blocks: [],
  selectedBlockId: null,
  errors: [],
}

// Mock Crypto for generateId
if (!global.crypto) {
  global.crypto = {
    randomUUID: () => 'test-id-' + Math.random().toString(36).substr(2, 9),
  } as any
}

describe('Editor Store Reducer', () => {
  it('should add a rich_text block to root', () => {
    const action = { type: 'ADD_BLOCK' as const, payload: { type: 'rich_text' as const } }
    const newState = editorReducer(INITIAL_STATE, action)
    expect(newState.blocks).toHaveLength(1)
    expect(newState.blocks[0].type).toBe('rich_text')
  })

  it('should add a section block to root', () => {
    const action = { type: 'ADD_BLOCK' as const, payload: { type: 'section' as const } }
    const newState = editorReducer(INITIAL_STATE, action)
    expect(newState.blocks).toHaveLength(1)
    expect(newState.blocks[0].type).toBe('section')
  })

  it('should add a nested block inside a section', () => {
    // Setup: 1 section
    const state1 = editorReducer(INITIAL_STATE, {
      type: 'ADD_BLOCK' as const,
      payload: { type: 'section' as const },
    })
    const sectionId = state1.blocks[0].id

    // Add text inside section
    const state2 = editorReducer(state1, {
      type: 'ADD_BLOCK' as const,
      payload: { parentId: sectionId, type: 'rich_text' as const },
    })

    const parent = state2.blocks[0] as any
    expect(parent.blocks).toHaveLength(1)
    expect(parent.blocks[0].type).toBe('rich_text')
  })

  it('should prevent nesting deeper than level 3', () => {
    // Level 1 Section
    const state1 = editorReducer(INITIAL_STATE, { type: 'ADD_BLOCK', payload: { type: 'section' } })
    const l1Id = state1.blocks[0].id

    // Level 2 Section
    const state2 = editorReducer(state1, {
      type: 'ADD_BLOCK',
      payload: { parentId: l1Id, type: 'section' },
    })
    const l2Id = (state2.blocks[0] as any).blocks[0].id

    // Level 3 Text
    const state3 = editorReducer(state2, {
      type: 'ADD_BLOCK',
      payload: { parentId: l2Id, type: 'rich_text' },
    })
    const l3Count = (state3.blocks[0] as any).blocks[0].blocks.length
    expect(l3Count).toBe(1)

    // Try add Section at Level 3 (making L3 a container -> invalid)
    // Actually my reducer logic prevents adding *anything* to a container if that container is at depth >= 3.
    // Wait, if I am at L3 (Depth 3 item), can I contain things?
    // L1 Section -> L2 Section -> L3 Item.
    // L3 Item cannot be a Container.
    // If I successfully added a Section at Level 3, it would be a L3 Container. Its children would be L4.
    // So Adding Section into L2 Section (which makes the new Section L3) IS allowed if L3 can contain nothing? No.
    // SectionBlockLevel3Schema: blocks: Array<Leaf>.
    // So L2 Section can contain L3 items (Leaves).
    // Can L2 Section contain L3 *Section*?
    // ExerciseBlockLevel3Schema = LeafBlockSchema. (No Section).
    // So L2 Section CANNOT contain a Section.

    // My reducer check:
    // "if (type === 'section' && found.depth >= 2) ... Cannot nest sections deeper than level 2"
    // found.depth is depth of the PARENT.
    // If parent is L2 (depth 2), then adding a child Section makes it L3 Section.
    // L3 Section is NOT allowed.
    // So check is correct.

    const state4 = editorReducer(state2, {
      type: 'ADD_BLOCK',
      payload: { parentId: l2Id, type: 'section' },
    })

    // Verify NO change
    const l1 = state4.blocks[0] as any
    const l2 = l1.blocks[0] as any
    // Should still have only the Text block from state3 (if we used state3), or empty if state2.
    // Using state2 as base
    expect(l2.blocks).toHaveLength(0)
  })

  it('should delete a block', () => {
    const state1 = editorReducer(INITIAL_STATE, {
      type: 'ADD_BLOCK',
      payload: { type: 'rich_text' },
    })
    const id = state1.blocks[0].id
    const state2 = editorReducer(state1, { type: 'DELETE_BLOCK', payload: id })
    expect(state2.blocks).toHaveLength(0)
  })
})
