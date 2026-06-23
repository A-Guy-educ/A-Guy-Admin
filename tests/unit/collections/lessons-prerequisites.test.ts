/**
 * @fileType unit-test
 * @domain collections
 * @pattern field-hook-validation
 * @ai-summary Test the prerequisites field on Lessons: bilingual label, dedupe, self-reference rejection
 */
import type { Field, FieldHook } from 'payload'
import { describe, expect, it } from 'vitest'

import { Lessons } from '@/server/payload/collections/Lessons'

type RelationshipField = Extract<Field, { type: 'relationship' }>

function getPrerequisitesField(): RelationshipField {
  const field = Lessons.fields.find((f) => 'name' in f && f.name === 'prerequisites')
  if (!field || field.type !== 'relationship') {
    throw new Error('prerequisites field not found')
  }
  return field as RelationshipField
}

function getBeforeValidateHook(): FieldHook {
  const field = getPrerequisitesField()
  const hook = field.hooks?.beforeValidate?.[0]
  if (!hook) throw new Error('beforeValidate hook not configured')
  return hook
}

async function runHook(args: {
  value: unknown
  originalDoc?: { id?: string }
  routeParamsId?: string
}) {
  const hook = getBeforeValidateHook()
  return hook({
    value: args.value,
    originalDoc: args.originalDoc,
    req: { routeParams: args.routeParamsId ? { id: args.routeParamsId } : undefined },
    // The rest of the FieldHook args are unused by this hook but required by the type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('Lessons prerequisites field', () => {
  it('configures relationTo: lessons, hasMany: true at the top level', () => {
    const field = getPrerequisitesField()
    expect(field.relationTo).toBe('lessons')
    expect(field.hasMany).toBe(true)
  })

  it('uses bilingual label "Prerequisites" / "תנאי קדם"', () => {
    const field = getPrerequisitesField()
    expect(field.label).toEqual({ en: 'Prerequisites', he: 'תנאי קדם' })
  })

  it('passes through null/undefined values unchanged', async () => {
    expect(await runHook({ value: undefined })).toBeUndefined()
    expect(await runHook({ value: null })).toBeNull()
  })

  it('dedupes duplicate string IDs', async () => {
    const result = await runHook({ value: ['a', 'b', 'a', 'c', 'b'] })
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('dedupes when entries are populated objects with id', async () => {
    const result = await runHook({
      value: [{ id: 'a' }, { id: 'b' }, { id: 'a' }],
    })
    expect(result).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('rejects self-reference based on originalDoc.id', async () => {
    await expect(runHook({ value: ['a', 'self'], originalDoc: { id: 'self' } })).rejects.toThrow(
      /cannot be a prerequisite of itself/i,
    )
  })

  it('rejects self-reference based on req.routeParams.id', async () => {
    await expect(runHook({ value: ['self'], routeParamsId: 'self' })).rejects.toThrow(
      /cannot be a prerequisite of itself/i,
    )
  })

  it('allows the same value array when no self id is present (create)', async () => {
    const result = await runHook({ value: ['a', 'b'] })
    expect(result).toEqual(['a', 'b'])
  })
})
