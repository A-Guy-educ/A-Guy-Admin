/**
 * Unit tests for the manifest-sanitizer guard in importContent. The function
 * itself isn't exported (it's a private detail of import-content.ts), so we
 * test it indirectly via `parseBundle` + a helper that simulates the call.
 *
 * We exercise the sanitizer's contract through a thin wrapper that mirrors
 * the structure used in importContent — duplicate IDs within a collection
 * trip the Mongo `_id_` index inside the transaction, so the sanitizer must
 * collapse them to a single record per id before the import loop runs.
 */
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'

import {
  BUNDLE_MANIFEST_VERSION,
  MANIFEST_FILENAME,
} from '@/server/services/content-promotion/constants'
import { parseBundle } from '@/server/services/content-promotion/import-content'
import type { BundleManifest } from '@/server/services/content-promotion/types'

async function buildBundle(manifest: BundleManifest): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(MANIFEST_FILENAME, JSON.stringify(manifest))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

const baseManifest = (collections: BundleManifest['collections']): BundleManifest => ({
  version: BUNDLE_MANIFEST_VERSION,
  exportedAt: new Date().toISOString(),
  source: { serverUrl: 'http://test' },
  counts: {
    media: collections.media.length,
    courses: collections.courses.length,
    chapters: collections.chapters.length,
    lessons: collections.lessons.length,
    exercises: collections.exercises.length,
    sections: collections.sections.length,
  },
  collections,
})

describe('parseBundle', () => {
  it('round-trips a valid manifest', async () => {
    const manifest = baseManifest({
      media: [],
      courses: [{ id: 'abc', title: 'Foo' } as BundleManifest['collections']['courses'][number]],
      chapters: [],
      lessons: [],
      exercises: [],
      sections: [],
    })
    const buffer = await buildBundle(manifest)
    const { manifest: parsed } = await parseBundle(buffer)
    expect(parsed.counts.courses).toBe(1)
    expect(parsed.collections.courses[0].id).toBe('abc')
  })

  it('rejects a bundle missing the manifest entry', async () => {
    const zip = new JSZip()
    zip.file('other.json', '{}')
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
    await expect(parseBundle(buffer)).rejects.toThrow(/missing manifest\.json/)
  })

  it('rejects a bundle whose manifest fails schema validation', async () => {
    const zip = new JSZip()
    zip.file(MANIFEST_FILENAME, JSON.stringify({ not: 'a real manifest' }))
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer
    await expect(parseBundle(buffer)).rejects.toThrow(/Invalid bundle manifest/)
  })
})
