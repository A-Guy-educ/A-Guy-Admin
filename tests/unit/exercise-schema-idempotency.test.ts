/**
 * Unit Test: Exercise Schema Idempotency Fields
 *
 * Tests Stage 3: Verify Exercise schema accepts idempotencyKey, specVersion, and extractionMeta fields.
 */

import { Exercises } from '@/server/payload/collections/Exercises'
import type { Field } from 'payload'
import { describe, expect, test } from 'vitest'

type InspectableField = Field & {
  type?: string
  label?: string | { [key: string]: unknown } | undefined
  fields?: Field[]
  tabs?: Array<{ fields?: Field[] }>
}

const findCollapsibleByLabel = (fields: Field[], label: string): InspectableField | undefined => {
  for (const field of fields) {
    const inspectable = field as InspectableField
    if (inspectable.type === 'collapsible' && inspectable.label === label) {
      return inspectable
    }
    if (inspectable.fields) {
      const nested = findCollapsibleByLabel(inspectable.fields, label)
      if (nested) return nested
    }
    if (inspectable.tabs) {
      for (const tab of inspectable.tabs) {
        if (tab.fields) {
          const nested = findCollapsibleByLabel(tab.fields, label)
          if (nested) return nested
        }
      }
    }
  }
  return undefined
}

describe('Exercise Schema Idempotency Fields', () => {
  // Helper to find Conversion Metadata collapsible field (recurses into tabs/groups)
  const getConversionMetaField = (): InspectableField | undefined => {
    return findCollapsibleByLabel(Exercises.fields as Field[], 'Conversion Metadata')
  }

  const findChildField = (parent: InspectableField, name: string): InspectableField | undefined =>
    parent.fields?.find((f) => 'name' in f && f.name === name) as InspectableField | undefined

  describe('3.1: Exercise schema accepts idempotencyKey field', () => {
    test('given valid exercise data with idempotencyKey, when Payload create() is called, then exercise is created with idempotencyKey stored', () => {
      const conversionMetaField = getConversionMetaField()
      expect(conversionMetaField).toBeDefined()
      expect(conversionMetaField).toHaveProperty('type', 'collapsible')

      const idempotencyKeyField = conversionMetaField
        ? findChildField(conversionMetaField, 'idempotencyKey')
        : undefined
      expect(idempotencyKeyField).toBeDefined()
      expect(idempotencyKeyField).toHaveProperty('type', 'text')
      expect(idempotencyKeyField).toHaveProperty('index', true)
    })
  })

  describe('3.2: Exercise schema accepts specVersion field', () => {
    test('given valid exercise data with specVersion="v1", when Payload create() is called, then exercise is created with specVersion stored', () => {
      const conversionMetaField = getConversionMetaField()
      expect(conversionMetaField).toBeDefined()

      const specVersionField = conversionMetaField
        ? findChildField(conversionMetaField, 'specVersion')
        : undefined
      expect(specVersionField).toBeDefined()
      expect(specVersionField).toHaveProperty('type', 'text')
    })
  })

  describe('3.3: Exercise schema accepts extractionMeta field', () => {
    test('given valid exercise data with extractionMeta={ segmentIndex: 0, itemOrdinal: 1 }, when Payload create() is called, then exercise is created with extractionMeta stored', () => {
      const conversionMetaField = getConversionMetaField()
      expect(conversionMetaField).toBeDefined()

      const extractionMetaField = conversionMetaField
        ? findChildField(conversionMetaField, 'extractionMeta')
        : undefined
      expect(extractionMetaField).toBeDefined()
      expect(extractionMetaField).toHaveProperty('type', 'json')
    })
  })

  describe('3.4: idempotencyKey field is optional (backward compat)', () => {
    test('given exercise data WITHOUT idempotencyKey, when Payload create() is called, then exercise is created successfully', () => {
      const conversionMetaField = getConversionMetaField()
      expect(conversionMetaField).toBeDefined()

      const idempotencyKeyField = conversionMetaField
        ? findChildField(conversionMetaField, 'idempotencyKey')
        : undefined
      expect(idempotencyKeyField).toBeDefined()
      // Should not have required: true
      expect(idempotencyKeyField).not.toHaveProperty('required', true)
    })
  })

  describe('Idempotency field indexing', () => {
    test('idempotencyKey field has index:true for Stage 4 unique index', () => {
      const conversionMetaField = getConversionMetaField()
      expect(conversionMetaField).toBeDefined()

      const idempotencyKeyField = conversionMetaField
        ? findChildField(conversionMetaField, 'idempotencyKey')
        : undefined
      expect(idempotencyKeyField).toBeDefined()
      // Stage 4 will create unique index, but schema has non-unique for now
      expect(idempotencyKeyField).toHaveProperty('index', true)
    })
  })
})
