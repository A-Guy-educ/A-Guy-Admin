/**
 * Unit tests for `resolveLessonPrompt` — the helper that decides whether the
 * lesson-scoped system prompt comes from the inline `promptOverride` textarea
 * or the legacy `prompt` relationship on the lesson.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveLessonPrompt } from '@/server/payload/endpoints/agent/chat/prompt-composition'
import type { Logger } from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => noopLogger,
} as unknown as Logger

const makePayload = () => ({
  findByID: vi.fn(),
})

describe('resolveLessonPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('synthesizes a published Prompt from a non-empty promptOverride and skips the DB', async () => {
    const payload = makePayload()
    const lesson = {
      promptOverride: 'Speak in the voice of an encouraging tutor.',
      prompt: 'prompt-legacy-id',
    }

    const result = await resolveLessonPrompt(payload as any, lesson, 'lesson-42', noopLogger)

    expect(result).not.toBeNull()
    expect(result?.template).toBe('Speak in the voice of an encouraging tutor.')
    expect(result?.status).toBe('published')
    expect(result?.id).toBe('lesson-lesson-42-override')
    // Override must NOT trigger a legacy Prompt lookup
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('trims the override before using it', async () => {
    const payload = makePayload()
    const lesson = { promptOverride: '   Trim me\n\n' }

    const result = await resolveLessonPrompt(payload as any, lesson, 'lesson-1', noopLogger)

    expect(result?.template).toBe('Trim me')
  })

  it('falls back to the legacy prompt relationship when override is whitespace-only', async () => {
    const payload = makePayload()
    const legacyPrompt = {
      id: 'prompt-legacy',
      title: 'Legacy',
      template: 'legacy body',
      status: 'published',
    }
    payload.findByID.mockResolvedValueOnce(legacyPrompt)

    const result = await resolveLessonPrompt(
      payload as any,
      { promptOverride: '   \n  ', prompt: 'prompt-legacy' },
      'lesson-1',
      noopLogger,
    )

    expect(result).toEqual(legacyPrompt)
    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'prompts', id: 'prompt-legacy' }),
    )
  })

  it('falls back to the legacy prompt relationship when override is missing', async () => {
    const payload = makePayload()
    const legacyPrompt = { id: 'p1', title: 't', template: 'x', status: 'published' }
    payload.findByID.mockResolvedValueOnce(legacyPrompt)

    const result = await resolveLessonPrompt(payload as any, { prompt: 'p1' }, 'l', noopLogger)

    expect(result).toEqual(legacyPrompt)
  })

  it('resolves the legacy prompt id when the relationship is a populated object', async () => {
    const payload = makePayload()
    payload.findByID.mockResolvedValueOnce({ id: 'p-obj', template: 'x', status: 'published' })

    await resolveLessonPrompt(
      payload as any,
      { prompt: { id: 'p-obj', title: 'x' } },
      'l',
      noopLogger,
    )

    expect(payload.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'prompts', id: 'p-obj' }),
    )
  })

  it('returns null when neither override nor prompt is set', async () => {
    const payload = makePayload()

    const result = await resolveLessonPrompt(payload as any, {}, 'l', noopLogger)

    expect(result).toBeNull()
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  it('returns null when the legacy prompt lookup throws', async () => {
    const payload = makePayload()
    payload.findByID.mockRejectedValueOnce(new Error('boom'))

    const result = await resolveLessonPrompt(
      payload as any,
      { prompt: 'missing-id' },
      'l',
      noopLogger,
    )

    expect(result).toBeNull()
  })
})
