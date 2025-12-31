import { describe, it, expect } from 'vitest'
import { ExerciseBlockSchema } from './blocks'
import { ExerciseContentSchema } from './content'

// Helper to create a simple leaf block
const createLeaf = (id: string, value = 'text') => ({
  id,
  type: 'rich_text',
  format: 'md-math-v1',
  value,
})

// Helper to create a section block
const createSection = (id: string, blocks: any[]) => ({
  id,
  type: 'section',
  blocks,
})

describe('Exercise Content', () => {
  it('validates a simple stem with leaf blocks', () => {
    const data = {
      contentSchemaVersion: 1,
      stem: [createLeaf('b1'), createLeaf('b2')],
    }
    const result = ExerciseContentSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates a stem with sections (Depth 1)', () => {
    const data = {
      contentSchemaVersion: 1,
      stem: [createSection('s1', [createLeaf('b1')])],
    }
    const result = ExerciseContentSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates nested sections (Depth 2)', () => {
    // Stem -> Section -> Section -> Leaf
    const data = {
      contentSchemaVersion: 1,
      stem: [createSection('s1', [createSection('s2', [createLeaf('b1')])])],
    }
    const result = ExerciseContentSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates max nested sections (Depth 3)', () => {
    // Stem -> Section -> Section -> Section -> Leaf
    const validData = {
      contentSchemaVersion: 1,
      stem: [createSection('level1', [createSection('level2', [createLeaf('leaf')])])],
    }
    expect(ExerciseContentSchema.safeParse(validData).success).toBe(true)
  })

  it('fails on too deep nesting (Depth 3 Section / Depth 4 Content)', () => {
    // Content -> Section(1) -> Section(2) -> Section(3) -> Leaf
    // This requires Level2 to contain a Section that is Level3.
    // But Level3Schema is Leaf-only.
    // So creating a Section at Level 3 should fail.

    const invalidData = {
      contentSchemaVersion: 1,
      stem: [
        createSection('level1', [
          createSection('level2', [
            createSection('level3', [
              // <--- Should fail here
              createLeaf('leaf'),
            ]),
          ]),
        ]),
      ],
    }

    const result = ExerciseContentSchema.safeParse(invalidData)
    expect(result.success).toBe(false)
  })

  it('validates figure block', () => {
    const data = {
      contentSchemaVersion: 1,
      stem: [
        {
          id: 'f1',
          type: 'figure',
          assetId: 'asset-123',
          caption: 'A caption',
        },
      ],
    }
    expect(ExerciseContentSchema.safeParse(data).success).toBe(true)
  })

  it('fails invalid block types', () => {
    const data = {
      contentSchemaVersion: 1,
      stem: [
        {
          id: 'bad',
          type: 'mega_construct', // Unknown
        },
      ],
    }
    expect(ExerciseContentSchema.safeParse(data).success).toBe(false)
  })
})
