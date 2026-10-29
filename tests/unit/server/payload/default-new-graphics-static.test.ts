/**
 * @fileType unit-test
 * @domain exercises
 * @pattern payload-hook
 * @ai-summary New axis/geometry graphs are saved static; existing and explicitly-set graphs are untouched
 */
import { describe, expect, it } from 'vitest'

import { defaultNewGraphicsStatic } from '@/server/payload/collections/Exercises/hooks/defaultNewGraphicsStatic'
import { markRequestAsContentPromotionImport } from '@/server/services/content-promotion/import-context'

type Block = Record<string, unknown>

const axisBlock = (id: string, axis: Block = {}): Block => ({
  id,
  type: 'question_axis',
  axis: { kind: 'cartesian', ...axis },
})
const geometryBlock = (id: string, geometry: Block = {}): Block => ({
  id,
  type: 'question_geometry',
  geometry: { kind: 'euclidean', ...geometry },
})

function run(blocks: Block[], originalBlocks?: Block[], req: Record<string, unknown> = {}) {
  const result = defaultNewGraphicsStatic({
    data: { title: 't', content: { blocks } },
    originalDoc: originalBlocks ? { content: { blocks: originalBlocks } } : undefined,
    req,
    operation: originalBlocks ? 'update' : 'create',
  } as never) as { content: { blocks: Block[] } }
  return result.content.blocks
}

describe('defaultNewGraphicsStatic', () => {
  it('sets interactive: false on graphs in a newly created doc', () => {
    const [axis, geometry] = run([axisBlock('a'), geometryBlock('g')])
    expect((axis.axis as Block).interactive).toBe(false)
    expect((geometry.geometry as Block).interactive).toBe(false)
  })

  it('covers graph attachments on question blocks', () => {
    const [block] = run([
      {
        id: 'q',
        type: 'question_free_response',
        attachment: { kind: 'geometry', geometry: { kind: 'euclidean' } },
      },
    ])
    expect(((block.attachment as Block).geometry as Block).interactive).toBe(false)
  })

  it('leaves graphs already on the stored doc untouched', () => {
    const existing = axisBlock('a')
    const [kept, added] = run([existing, axisBlock('new')], [existing])
    expect(kept.axis as Block).not.toHaveProperty('interactive')
    expect((added.axis as Block).interactive).toBe(false)
  })

  it('keeps an explicit interactive: true on new graphs', () => {
    const [block] = run([axisBlock('a', { interactive: true })])
    expect((block.axis as Block).interactive).toBe(true)
  })

  it('skips content-promotion imports', () => {
    const req: Record<string, unknown> = {}
    markRequestAsContentPromotionImport(req as never)
    const [block] = run([axisBlock('a')], undefined, req)
    expect(block.axis as Block).not.toHaveProperty('interactive')
  })

  it('passes through data without content', () => {
    const data = { title: 'only title' }
    expect(defaultNewGraphicsStatic({ data, req: {} } as never)).toBe(data)
  })
})
