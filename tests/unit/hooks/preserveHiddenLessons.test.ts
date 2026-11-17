/**
 * A-Guy-Web owns classes.hiddenLessons; an Admin save must never overwrite or
 * revert what a teacher hid while the class was open in the editor.
 */
import { describe, expect, it } from 'vitest'

import { Classes } from '@/server/payload/collections/Classes'
import { preserveHiddenLessons } from '@/server/payload/hooks/classes/preserveHiddenLessons'

type HookArgs = Parameters<typeof preserveHiddenLessons>[0]

const runHook = (
  data: Record<string, unknown>,
  storedHiddenLessons: string[] | undefined,
  operation: 'create' | 'update' = 'update',
) =>
  preserveHiddenLessons({
    data,
    operation,
    originalDoc: { id: 'c1', hiddenLessons: storedHiddenLessons },
  } as unknown as HookArgs)

describe('preserveHiddenLessons', () => {
  it('keeps the stored ids when the submitted value differs', () => {
    expect(runHook({ hiddenLessons: ['l1'] }, ['l1', 'l2'])).toEqual({
      hiddenLessons: ['l1', 'l2'],
    })
  })

  it('keeps the stored ids when the submitted value is empty', () => {
    expect(runHook({ hiddenLessons: [] }, ['l1'])).toEqual({ hiddenLessons: ['l1'] })
  })

  it('restores the stored ids when the save omits the field', () => {
    expect(runHook({ name: 'x' }, ['l1'])).toEqual({ name: 'x', hiddenLessons: ['l1'] })
  })

  it('leaves the field unset on update when nothing is stored', () => {
    expect(runHook({ hiddenLessons: ['l1'] }, undefined)).toEqual({})
  })

  it('drops a submitted value on create', () => {
    expect(runHook({ name: 'x', hiddenLessons: ['l1'] }, undefined, 'create')).toEqual({
      name: 'x',
    })
  })

  it('passes other fields through unchanged without mutating the input', () => {
    const data = { name: 'x', students: ['s1'], hiddenLessons: [] }
    const result = runHook(data, ['l1'])
    expect(result).toEqual({ name: 'x', students: ['s1'], hiddenLessons: ['l1'] })
    expect(data).toEqual({ name: 'x', students: ['s1'], hiddenLessons: [] })
  })

  it('is wired into the Classes collection after preserveConcurrentStudents', () => {
    const hooks = Classes.hooks?.beforeChange ?? []
    expect(hooks.at(-1)).toBe(preserveHiddenLessons)
    expect(Classes.fields).toContainEqual(
      expect.objectContaining({
        name: 'hiddenLessons',
        admin: expect.objectContaining({ readOnly: true }),
      }),
    )
  })
})
