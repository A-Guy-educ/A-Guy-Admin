/**
 * Unit tests for `prepareExerciseForBulkInsert` — the pure-function core of
 * the exercises bulk-insert path. All the DB-touching behavior is delegated
 * to a raw `insertMany` shell that we don't cover here; instead we verify
 * that everything Payload's `payload.create` normally does to a bundled
 * exercise doc — id remap, content validation, `_id` typing, required-field
 * backfill, relationship-id typing — is faithfully reproduced by this pure
 * function BEFORE anything hits Mongo. That's where every past bulk-insert
 * regression has originated (see PR #218 review).
 */
import { describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'

import { IdRemap } from '@/server/services/content-promotion/id-remap'
import { prepareExerciseForBulkInsert } from '@/server/services/content-promotion/import-content'

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

function baseExercise(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: HEX_A,
    title: 'Test',
    content: validContent(),
    lesson: HEX_B,
    tenant: HEX_C,
    origin: 'manual',
    locale: 'he',
    ...overrides,
  }
}

describe('prepareExerciseForBulkInsert', () => {
  it('produces an insert-ready doc with _id as ObjectId when everything is well-formed', () => {
    const result = prepareExerciseForBulkInsert(baseExercise(), new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.prepared.finalId).toBe(HEX_A)
    expect(result.prepared.wasRemapped).toBe(false)
    expect(result.prepared.doc._id).toBeInstanceOf(ObjectId)
    expect((result.prepared.doc._id as ObjectId).toHexString()).toBe(HEX_A)
    // `id` is Payload's virtual field — it must NOT reach Mongo.
    expect(result.prepared.doc).not.toHaveProperty('id')
  })

  it('uses the remapped id when the source id collided on the target', () => {
    const remap = new IdRemap()
    remap.set('exercises', HEX_A, HEX_B)
    const result = prepareExerciseForBulkInsert(baseExercise(), remap, HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.prepared.finalId).toBe(HEX_B)
    expect(result.prepared.wasRemapped).toBe(true)
    expect((result.prepared.doc._id as ObjectId).toHexString()).toBe(HEX_B)
  })

  it('fails with a helpful message when content fails schema validation', () => {
    const doc = baseExercise({ content: { blocks: [] } }) // blocks.min(1) violated
    const result = prepareExerciseForBulkInsert(doc, new IdRemap(), HEX_C)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.finalId).toBe(HEX_A)
    expect(result.message).toMatch(/Content validation failed/)
  })

  it('fails rather than storing a mismatched-shape _id when the finalId is not 24-hex', () => {
    const doc = baseExercise({ id: 'not-an-object-id' })
    const result = prepareExerciseForBulkInsert(doc, new IdRemap(), HEX_C)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/not a valid 24-hex ObjectId/)
  })

  it('backfills origin and locale when the source doc is missing them', () => {
    const doc = baseExercise()
    delete doc.origin
    delete doc.locale
    const result = prepareExerciseForBulkInsert(doc, new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.origin).toBe('manual')
    expect(result.prepared.doc.locale).toBe('he')
  })

  it('leaves explicit origin/locale values untouched', () => {
    const result = prepareExerciseForBulkInsert(
      baseExercise({ origin: 'imported', locale: 'en' }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.origin).toBe('imported')
    expect(result.prepared.doc.locale).toBe('en')
  })

  it('applies the default tenant when the doc is missing tenant', () => {
    const doc = baseExercise()
    delete doc.tenant
    const result = prepareExerciseForBulkInsert(doc, new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Tenant is a relationship field, so the string default must also be
    // cast to ObjectId along with every other relationship value below.
    expect(result.prepared.doc.tenant).toBeInstanceOf(ObjectId)
    expect((result.prepared.doc.tenant as ObjectId).toHexString()).toBe(HEX_C)
  })

  it('does not overwrite an explicit tenant even when a default is provided', () => {
    const explicitTenant = HEX_A
    const result = prepareExerciseForBulkInsert(
      baseExercise({ tenant: explicitTenant }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.prepared.doc.tenant as ObjectId).toHexString()).toBe(explicitTenant)
  })

  it('leaves tenant undefined when both the doc and the default are missing', () => {
    const doc = baseExercise()
    delete doc.tenant
    const result = prepareExerciseForBulkInsert(doc, new IdRemap(), null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // We intentionally do NOT invent a tenant here — the required-field
    // check for that particular doc will surface a per-doc failure at the
    // insertMany call site instead of masking a config bug.
    expect(result.prepared.doc.tenant).toBeUndefined()
  })

  it('casts every known relationship field to ObjectId', () => {
    const result = prepareExerciseForBulkInsert(
      baseExercise({
        chapter: HEX_A,
        course: HEX_B,
        translatedFrom: HEX_C,
        sourceDoc: HEX_A,
        createdBy: HEX_B,
      }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const field of [
      'lesson',
      'chapter',
      'course',
      'tenant',
      'translatedFrom',
      'sourceDoc',
      'createdBy',
    ] as const) {
      expect(result.prepared.doc[field]).toBeInstanceOf(ObjectId)
    }
  })

  it('leaves non-24-hex relationship values untouched', () => {
    const result = prepareExerciseForBulkInsert(
      baseExercise({ lesson: 'not-an-object-id' }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.lesson).toBe('not-an-object-id')
  })

  it('coerces ISO-string createdAt/updatedAt from the bundle into BSON Date', () => {
    // Bundles arrive from JSON.parse, so dates are strings — must be cast
    // back to Date or downstream date-range queries silently miss these docs.
    const result = prepareExerciseForBulkInsert(
      baseExercise({
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
    expect((result.prepared.doc.updatedAt as Date).toISOString()).toBe('2024-02-01T00:00:00.000Z')
  })

  it('backfills createdAt/updatedAt when missing so Mongo does not reject the insert', () => {
    const result = prepareExerciseForBulkInsert(baseExercise(), new IdRemap(), HEX_C)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prepared.doc.createdAt).toBeInstanceOf(Date)
    expect(result.prepared.doc.updatedAt).toBeInstanceOf(Date)
  })

  it('falls back to now() when createdAt/updatedAt is a garbage string', () => {
    const result = prepareExerciseForBulkInsert(
      baseExercise({ createdAt: 'not-a-date', updatedAt: 'also-nope' }),
      new IdRemap(),
      HEX_C,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Never store the garbage string — insertMany would happily accept it,
    // then every date-range query would miss the doc.
    expect(result.prepared.doc.createdAt).toBeInstanceOf(Date)
    expect(result.prepared.doc.updatedAt).toBeInstanceOf(Date)
  })
})
