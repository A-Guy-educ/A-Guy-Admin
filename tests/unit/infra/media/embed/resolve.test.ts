import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveEmbedUrl } from '@/infra/media/embed/resolve'

// Mock the YouTube resolver so we test the routing logic, not YouTube parsing
vi.mock('@/infra/media/embed/youtube', () => ({
  resolveYouTube: vi.fn(),
}))

import { resolveYouTube } from '@/infra/media/embed/youtube'

describe('resolveEmbedUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return YouTube metadata when URL is a YouTube URL', async () => {
    const mockMetadata = {
      provider: 'youtube' as const,
      videoId: 'abc123xxxxx',
      embedUrl: 'https://www.youtube-nocookie.com/embed/abc123xxxxx',
      title: 'Test',
      thumbnailUrl: 'https://thumb.jpg',
    }
    vi.mocked(resolveYouTube).mockResolvedValue(mockMetadata)

    const result = await resolveEmbedUrl('https://youtube.com/watch?v=abc123xxxxx')

    expect(result).toEqual(mockMetadata)
  })

  it('should return generic metadata when no provider matches', async () => {
    vi.mocked(resolveYouTube).mockResolvedValue(null)

    const result = await resolveEmbedUrl('https://example.com/some-page')

    expect(result).toEqual({
      provider: 'generic',
      videoId: null,
      embedUrl: 'https://example.com/some-page',
      thumbnailUrl: null,
      title: null,
    })
  })
})
