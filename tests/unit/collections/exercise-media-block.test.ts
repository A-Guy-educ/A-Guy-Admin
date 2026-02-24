/**
 * @fileType unit-test
 * @domain exercises
 * @pattern schema-validation, block-factory
 * @ai-summary Unit tests for MediaBlock schema validation, type inference, and factory functions
 */
import { describe, expect, it } from 'vitest'

// Import directly from source files to test implementation
import {
  MediaBlockSchema,
  ContentBlockSchema,
  ContentSchema,
} from '@/server/payload/collections/Exercises/schemas'
import type { MediaBlock } from '@/server/payload/collections/Exercises/types'
import { ExerciseBlockDefaults, generateId } from '@/server/payload/collections/Exercises/defaults'

describe('MediaBlock Schema Validation', () => {
  describe('Valid MediaBlock', () => {
    it('should validate a complete media block', () => {
      const validMediaBlock = {
        id: 'block-123',
        type: 'media' as const,
        mediaId: 'media-456',
      }

      const result = MediaBlockSchema.safeParse(validMediaBlock)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(validMediaBlock)
      }
    })

    it('should validate media block with UUID id', () => {
      const validMediaBlock = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'media' as const,
        mediaId: 'media-abc-123',
      }

      const result = MediaBlockSchema.safeParse(validMediaBlock)

      expect(result.success).toBe(true)
    })

    it('should validate media block with minimal valid id', () => {
      const validMediaBlock = {
        id: 'a',
        type: 'media' as const,
        mediaId: 'b',
      }

      const result = MediaBlockSchema.safeParse(validMediaBlock)

      expect(result.success).toBe(true)
    })
  })

  describe('Invalid MediaBlock', () => {
    it('should reject when id is empty', () => {
      const invalidMediaBlock = {
        id: '',
        type: 'media' as const,
        mediaId: 'media-123',
      }

      const result = MediaBlockSchema.safeParse(invalidMediaBlock)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('id')
        // Zod error message is "Too small: expected string to have >=1 characters"
        expect(result.error.issues[0].message).toContain('Too small')
      }
    })

    it('should reject when mediaId is empty', () => {
      const invalidMediaBlock = {
        id: 'block-123',
        type: 'media' as const,
        mediaId: '',
      }

      const result = MediaBlockSchema.safeParse(invalidMediaBlock)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('mediaId')
        // Zod error message is "Too small: expected string to have >=1 characters"
        expect(result.error.issues[0].message).toContain('Too small')
      }
    })

    it('should reject when type is not "media"', () => {
      const invalidMediaBlock = {
        id: 'block-123',
        type: 'image',
        mediaId: 'media-123',
      }

      const result = MediaBlockSchema.safeParse(invalidMediaBlock)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('type')
      }
    })

    it('should reject with extra unknown fields (strict mode)', () => {
      const invalidMediaBlock = {
        id: 'block-123',
        type: 'media' as const,
        mediaId: 'media-456',
        unknownField: 'should be rejected',
      }

      const result = MediaBlockSchema.safeParse(invalidMediaBlock)

      expect(result.success).toBe(false)
      if (!result.success) {
        // Strict mode rejects unknown keys - Zod message is "Unrecognized key: \"unknownField\""
        expect(result.error.issues[0].message).toContain('Unrecognized key')
      }
    })

    it('should reject when id is missing', () => {
      const invalidMediaBlock = {
        type: 'media' as const,
        mediaId: 'media-123',
      }

      const result = MediaBlockSchema.safeParse(invalidMediaBlock)

      expect(result.success).toBe(false)
    })

    it('should reject when type is missing', () => {
      const invalidMediaBlock = {
        id: 'block-123',
        mediaId: 'media-123',
      }

      const result = MediaBlockSchema.safeParse(invalidMediaBlock)

      expect(result.success).toBe(false)
    })

    it('should reject when mediaId is missing', () => {
      const invalidMediaBlock = {
        id: 'block-123',
        type: 'media' as const,
      }

      const result = MediaBlockSchema.safeParse(invalidMediaBlock)

      expect(result.success).toBe(false)
    })
  })
})

describe('MediaBlock Type Inference', () => {
  it('should correctly infer MediaBlock type from valid data', () => {
    const validData = {
      id: 'test-id',
      type: 'media' as const,
      mediaId: 'media-id',
    }

    // This tests that TypeScript correctly narrows the type
    const result = MediaBlockSchema.parse(validData)

    // The parsed result should match MediaBlock interface
    expect(result.id).toBe(validData.id)
    expect(result.type).toBe('media')
    expect(result.mediaId).toBe(validData.mediaId)
  })

  it('should produce ContentBlock type when parsed through discriminated union', () => {
    const mediaBlockData = {
      id: 'media-block-id',
      type: 'media' as const,
      mediaId: 'media-file-id',
    }

    const result = ContentBlockSchema.parse(mediaBlockData)

    // Should be typed as ContentBlock with media type
    expect(result).toHaveProperty('type', 'media')
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('mediaId')
  })

  it('should be distinguishable from other block types in union', () => {
    const mediaBlock = {
      id: 'block-1',
      type: 'media' as const,
      mediaId: 'media-1',
    }

    const richTextBlock = {
      id: 'block-2',
      type: 'rich_text' as const,
      format: 'md-math-v1',
      value: 'Hello',
      mediaIds: [],
    }

    const latexBlock = {
      id: 'block-3',
      type: 'latex' as const,
      latex: 'E = mc^2',
    }

    const mediaResult = ContentBlockSchema.parse(mediaBlock)
    const richTextResult = ContentBlockSchema.parse(richTextBlock)
    const latexResult = ContentBlockSchema.parse(latexBlock)

    // Each should have distinct type discriminator
    expect(mediaResult.type).toBe('media')
    expect(richTextResult.type).toBe('rich_text')
    expect(latexResult.type).toBe('latex')

    // Type narrowing should work correctly
    if (mediaResult.type === 'media') {
      expect(mediaResult.mediaId).toBeDefined()
    }
  })
})

describe('ExerciseBlockDefaults.media() Factory', () => {
  it('should create a valid MediaBlock structure', () => {
    const mediaBlock = ExerciseBlockDefaults.media() as MediaBlock

    // Should have required properties
    expect(mediaBlock).toHaveProperty('id')
    expect(mediaBlock).toHaveProperty('type')
    expect(mediaBlock).toHaveProperty('mediaId')

    // Should have correct types
    expect(typeof mediaBlock.id).toBe('string')
    expect(mediaBlock.type).toBe('media')
    expect(typeof mediaBlock.mediaId).toBe('string')
  })

  it('should create a block with a valid non-empty id', () => {
    const mediaBlock = ExerciseBlockDefaults.media() as MediaBlock

    // ID should be non-empty (generated via generateId)
    expect(mediaBlock.id.length).toBeGreaterThan(0)
  })

  it('should create a block with empty mediaId by default', () => {
    const mediaBlock = ExerciseBlockDefaults.media() as MediaBlock

    // Default mediaId should be empty string (user must select media)
    expect(mediaBlock.mediaId).toBe('')
  })

  it('should create unique ids for each call', () => {
    const block1 = ExerciseBlockDefaults.media() as MediaBlock
    const block2 = ExerciseBlockDefaults.media() as MediaBlock

    // Each call should generate a unique id
    expect(block1.id).not.toBe(block2.id)
  })

  it('should create a block that passes schema validation when mediaId is provided', () => {
    const mediaBlock = ExerciseBlockDefaults.media() as MediaBlock

    // Factory creates block with empty mediaId, so we need to fill it in first
    const filledBlock: MediaBlock = {
      ...mediaBlock,
      mediaId: 'valid-media-id',
    }

    const result = MediaBlockSchema.safeParse(filledBlock)

    expect(result.success).toBe(true)
  })

  it('should be usable in ContentBlockSchema union when mediaId is provided', () => {
    const mediaBlock = ExerciseBlockDefaults.media() as MediaBlock

    // Factory creates block with empty mediaId, so we need to fill it in first
    const filledBlock: MediaBlock = {
      ...mediaBlock,
      mediaId: 'valid-media-id',
    }

    const result = ContentBlockSchema.safeParse(filledBlock)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('media')
    }
  })
})

describe('ContentBlockSchema Union includes MediaBlock', () => {
  it('should accept MediaBlock in the content union', () => {
    const contentWithMedia = {
      blocks: [
        {
          id: 'block-1',
          type: 'media' as const,
          mediaId: 'media-123',
        },
      ],
    }

    const result = ContentSchema.safeParse(contentWithMedia)

    expect(result.success).toBe(true)
  })

  it('should accept multiple block types including MediaBlock', () => {
    const mixedContent = {
      blocks: [
        {
          id: 'rich-text-1',
          type: 'rich_text' as const,
          format: 'md-math-v1',
          value: 'Some text',
          mediaIds: [],
        },
        {
          id: 'media-1',
          type: 'media' as const,
          mediaId: 'media-123',
        },
        {
          id: 'latex-1',
          type: 'latex' as const,
          latex: 'x^2',
        },
      ],
    }

    const result = ContentSchema.safeParse(mixedContent)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.blocks).toHaveLength(3)
    }
  })

  it('should validate as ContentBlock type when containing MediaBlock', () => {
    const content = {
      blocks: [
        {
          id: 'media-block',
          type: 'media' as const,
          mediaId: 'media-file',
        },
      ],
    }

    const result = ContentSchema.parse(content)

    // TypeScript should infer this as ContentData
    expect(result.blocks[0].type).toBe('media')

    // Can narrow to MediaBlock using type guard
    const block = result.blocks[0]
    // Use type assertion for testing since discriminated union narrowing
    // requires runtime type check
    const mediaBlock = block as MediaBlock
    expect(mediaBlock.mediaId).toBe('media-file')
  })

  it('should reject invalid block within content', () => {
    const invalidContent = {
      blocks: [
        {
          id: 'block-1',
          type: 'media' as const,
          // Missing mediaId - should fail
        },
      ],
    }

    const result = ContentSchema.safeParse(invalidContent)

    expect(result.success).toBe(false)
  })
})

describe('MediaBlock in Exercise Content Flow', () => {
  it('should be create-able from defaults and pass full validation', () => {
    // Simulate the flow: create via factory -> add to content -> validate
    const newMediaBlock = ExerciseBlockDefaults.media() as MediaBlock

    // Simulate user selecting a media file
    const filledMediaBlock: MediaBlock = {
      ...newMediaBlock,
      mediaId: 'user-selected-media-id',
    }

    // Validate the filled block
    const fillResult = MediaBlockSchema.safeParse(filledMediaBlock)
    expect(fillResult.success).toBe(true)

    // Add to content structure
    const contentData = {
      blocks: [filledMediaBlock],
    }

    // Validate full content
    const contentResult = ContentSchema.safeParse(contentData)
    expect(contentResult.success).toBe(true)
  })

  it('should allow MediaBlock to be the only block in content', () => {
    const contentWithOnlyMedia = {
      blocks: [
        {
          id: 'only-media-block',
          type: 'media' as const,
          mediaId: 'some-media-id',
        },
      ],
    }

    const result = ContentSchema.safeParse(contentWithOnlyMedia)

    expect(result.success).toBe(true)
  })

  it('should handle MediaBlock with various mediaId formats', () => {
    const mediaIds = [
      'media-123',
      '550e8400-e29b-41d4-a716-446655440000',
      'blob:abc123',
      'file-uploads/image.jpg',
    ]

    for (const mediaId of mediaIds) {
      const block = {
        id: generateId(),
        type: 'media' as const,
        mediaId,
      }

      const result = MediaBlockSchema.safeParse(block)
      expect(result.success).toBe(true)
    }
  })
})
