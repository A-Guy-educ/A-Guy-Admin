/**
 * Unit tests for `prepareSectionForBulkInsert` — the pure-function core of
 * the sections bulk-insert path, mirror of the exercises bulk-insert tests
 * (see content-promotion-bulk-insert.test.ts).
 *
 * The DB-touching shell (`bulkCreateSections`) delegates every per-doc
 * decision to this pure function, so covering it here catches the failures
 * that would otherwise surface only as opaque Mongo errors in production.
 */
import { describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'

import { IdRemap } from '@/server/services/content-promotion/id-remap'
import { prepareSectionForBulkInsert } from '@/server/services/content-promotion/import-content'

const HEX_A = '507f1f77bcf86cd799439011'
const HEX_B = '507f1f77bcf86cd799439012'
const HEX_C = '507f1f77bcf86cd799439013'

function validContent() {
  return {
    blocks: [
      {
        id: 'block-1',
        type: 'rich_text',
        format: 'md-math-v1',
        value: 'hello',
        mediaIds: [],
      },
    ],
  }
}

function baseSection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: HEX_A,
    title: 'Test section',
    order: 1,
    exerciseType: 'basic',
    exercise: HEX_B,
    content: validContent(),
    tenant: HEX_C,
    locale: 'he',
    ...overrides,
  }
}

describe('prepareSectionForBulkInsert', () => {
  it('produces an insert-ready doc with _id as ObjectId when everything is well-formed', () => {
    const result = prepareSectionForBulkInsert(baseSection(), new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.prepared.finalId).toBe(HEX_A)
    expect(result.prepared.wasRemapped).toBe(false)
    expect(result.prepared.doc._id).toBeInstanceOf(ObjectId)
    expect((result.prepared.doc._id as ObjectId).toHexString()).toBe(HEX_A)
    expect(result.prepared.doc).not.toHaveProperty('id')
  })

  it('uses the remapped id when the source id collided on the target', () => {
    const remap = new IdRemap()
    remap.set('sections', HEX_A, HEX_B)
    const result = prepareSectionForBulkInsert(baseSection(), remap, HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.prepared.finalId).toBe(HEX_B)
    expect(result.prepared.wasRemapped).toBe(true)
    expect((result.prepared.doc._id as ObjectId).toHexString()).toBe(HEX_B)
  })

  it('fails when content fails ContentSchema validation', () => {
    const doc = baseSection({ content: { blocks: [] } })
    const result = prepareSectionForBulkInsert(doc, new IdRemap(), HEX_C)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.finalId).toBe(HEX_A)
    expect(result.message).toMatch(/Content validation failed/)
  })

  it('fails rather than storing a mismatched-shape _id when the finalId is not 24-hex', () => {
    const result = prepareSectionForBulkInsert(
      baseSection({ id: 'not-an-object-id' }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/not a valid 24-hex ObjectId/)
  })

  it('backfills locale when the source doc is missing it', () => {
    const doc = baseSection()
    delete doc.locale
    const result = prepareSectionForBulkInsert(doc, new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.locale).toBe('he')
  })

  it('applies the default tenant when the doc is missing tenant', () => {
    const doc = baseSection()
    delete doc.tenant
    const result = prepareSectionForBulkInsert(doc, new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.tenant).toBeInstanceOf(ObjectId)
    expect((result.prepared.doc.tenant as ObjectId).toHexString()).toBe(HEX_C)
  })

  it('casts exercise + tenant + denorm chain fields to ObjectId', () => {
    const result = prepareSectionForBulkInsert(
      baseSection({ lesson: HEX_A, chapter: HEX_B, course: HEX_C }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const field of ['exercise', 'lesson', 'chapter', 'course', 'tenant'] as const) {
      expect(result.prepared.doc[field]).toBeInstanceOf(ObjectId)
    }
  })

  it('coerces ISO-string createdAt/updatedAt to BSON Date', () => {
    const result = prepareSectionForBulkInsert(
      baseSection({
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-02-01T00:00:00.000Z',
      }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.createdAt).toBeInstanceOf(Date)
    expect((result.prepared.doc.createdAt as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })

  it('backfills createdAt/updatedAt when missing so Mongo does not reject the insert', () => {
    const result = prepareSectionForBulkInsert(baseSection(), new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.createdAt).toBeInstanceOf(Date)
    expect(result.prepared.doc.updatedAt).toBeInstanceOf(Date)
  })
})
