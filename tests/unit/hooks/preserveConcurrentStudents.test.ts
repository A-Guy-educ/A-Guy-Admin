/**
 * A-Guy-Web's /join $push-es students onto classes.students; an Admin save must
 * not drop students who joined after the editor loaded the class.
 */
import { describe, expect, it } from 'vitest'
import type { FieldHook } from 'payload'

import { Classes } from '@/server/payload/collections/Classes'
import {
  LOADED_STUDENTS_FIELD,
  loadedStudentsField,
  preserveConcurrentStudents,
} from '@/server/payload/hooks/classes/preserveConcurrentStudents'

type HookArgs = Parameters<typeof preserveConcurrentStudents>[0]

const runHook = (
  data: Record<string, unknown>,
  storedStudents: string[],
  operation: 'create' | 'update' = 'update',
) =>
  preserveConcurrentStudents({
    data,
    operation,
    originalDoc: { id: 'c1', students: storedStudents },
  } as unknown as HookArgs)

describe('preserveConcurrentStudents', () => {
  it('keeps a student who joined after the form loaded', () => {
    const result = runHook({ students: ['s1'], [LOADED_STUDENTS_FIELD]: ['s1'] }, ['s1', 's2'])
    expect(result).toEqual({ students: ['s1', 's2'] })
  })

  it('still lets the editor remove a student they saw', () => {
    const result = runHook({ students: ['s2'], [LOADED_STUDENTS_FIELD]: ['s1', 's2'] }, [
      's1',
      's2',
    ])
    expect(result).toEqual({ students: ['s2'] })
  })

  it('keeps a joiner while honoring a removal in the same save', () => {
    const result = runHook({ students: ['s2'], [LOADED_STUDENTS_FIELD]: ['s1', 's2'] }, [
      's1',
      's2',
      's3',
    ])
    expect(result).toEqual({ students: ['s2', 's3'] })
  })

  it('does not duplicate a joiner the editor also added', () => {
    const result = runHook({ students: ['s1', 's2'], [LOADED_STUDENTS_FIELD]: ['s1'] }, [
      's1',
      's2',
    ])
    expect(result).toEqual({ students: ['s1', 's2'] })
  })

  it('accepts populated student docs in the submitted data', () => {
    const result = runHook({ students: [{ id: 's1' }], [LOADED_STUDENTS_FIELD]: ['s1'] }, [
      's1',
      's2',
    ])
    expect(result).toEqual({ students: [{ id: 's1' }, 's2'] })
  })

  it('keeps plain overwrite semantics when no snapshot is sent', () => {
    expect(runHook({ students: ['s1'] }, ['s1', 's2'])).toEqual({ students: ['s1'] })
  })

  it('leaves students alone when the save does not touch them', () => {
    expect(runHook({ name: 'x', [LOADED_STUDENTS_FIELD]: ['s1'] }, ['s1', 's2'])).toEqual({
      name: 'x',
    })
  })

  it('ignores the snapshot on create', () => {
    expect(runHook({ students: ['s1'], [LOADED_STUDENTS_FIELD]: [] }, [], 'create')).toEqual({
      students: ['s1'],
    })
  })
})

describe('loadedStudentsField', () => {
  it('is a hidden virtual field so it never reaches Mongo', () => {
    expect(loadedStudentsField).toMatchObject({ virtual: true, admin: { hidden: true } })
  })

  it('snapshots the loaded student ids, populated or not', () => {
    const hook = (loadedStudentsField as { hooks: { afterRead: FieldHook[] } }).hooks.afterRead[0]
    const result = hook({ siblingData: { students: ['s1', { id: 's2' }] } } as never)
    expect(result).toEqual(['s1', 's2'])
  })

  it('is wired into the Classes collection', () => {
    expect(Classes.fields).toContain(loadedStudentsField)
    expect(Classes.hooks?.beforeChange).toContain(preserveConcurrentStudents)
  })
})
