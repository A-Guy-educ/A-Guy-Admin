// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { useLessonBlocks } from '@/ui/admin/LessonStudio/useLessonBlocks'

/**
 * @fileType unit-test
 * @domain admin, lesson-studio
 * @ai-summary useLessonBlocks seeds lesson content from the tree, tracks dirty edits, and guards the last block
 */

const block = (id: string, value = ''): ContentBlock =>
  ({ id, type: 'rich_text', format: 'md-math-v1', value, mediaIds: [] }) as ContentBlock

// The tree hands the hook a stable array per fetch; mirror that here so the
// seed effect doesn't re-fire on every render.
const setup = (server: ContentBlock[]) => renderHook(() => useLessonBlocks(server))

describe('useLessonBlocks', () => {
  it('seeds from server blocks and starts clean', () => {
    const { result } = setup([block('a')])
    expect(result.current.blocks.map((b) => b.id)).toEqual(['a'])
    expect(result.current.dirty).toBe(false)
  })

  it('inserts at a position and marks dirty', () => {
    const { result } = setup([block('a'), block('b')])
    act(() => result.current.onAddBlock(block('x'), 1))
    expect(result.current.blocks.map((b) => b.id)).toEqual(['a', 'x', 'b'])
    expect(result.current.dirty).toBe(true)
  })

  it('appends when the lesson has no blocks yet', () => {
    const { result } = setup([])
    act(() => result.current.onAddBlock(block('x')))
    expect(result.current.blocks.map((b) => b.id)).toEqual(['x'])
  })

  it('never deletes the last block', () => {
    const { result } = setup([block('a')])
    act(() => result.current.onDeleteBlock(0))
    expect(result.current.blocks.map((b) => b.id)).toEqual(['a'])
  })

  it('does not reseed over unsaved edits on refetch', () => {
    const { result, rerender } = renderHook(({ server }) => useLessonBlocks(server), {
      initialProps: { server: [block('a')] },
    })
    act(() => result.current.onBlockChange(0, block('a', 'edited')))
    rerender({ server: [block('a', 'server')] })
    expect((result.current.blocks[0] as { value: string }).value).toBe('edited')
  })

  it('markSaved clears dirty only for the current array', () => {
    const { result } = setup([block('a')])
    act(() => result.current.onBlockChange(0, block('a', 'v1')))
    const saved = result.current.blocks
    act(() => result.current.onBlockChange(0, block('a', 'v2')))
    act(() => result.current.markSaved(saved))
    expect(result.current.dirty).toBe(true)
    act(() => result.current.markSaved(result.current.blocks))
    expect(result.current.dirty).toBe(false)
  })
})
