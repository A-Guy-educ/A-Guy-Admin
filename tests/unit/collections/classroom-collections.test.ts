/**
 * Classroom collections (schools, classes, question-attempts) are read directly
 * from Mongo by A-Guy-Web, so slugs and field names are a cross-repo contract.
 */
import { describe, expect, it } from 'vitest'
import type { CollectionConfig, Field } from 'payload'

import { Classes } from '@/server/payload/collections/Classes'
import { QuestionAttempts } from '@/server/payload/collections/QuestionAttempts'
import { Schools } from '@/server/payload/collections/Schools'
import { AccountRole } from '@/server/payload/collections/Users/roles'
import { normalizeRelationshipIds } from '@/server/payload/hooks/normalizeRelationshipIds'

const fieldNames = (c: CollectionConfig) =>
  c.fields.filter((f): f is Field & { name: string } => 'name' in f).map((f) => f.name)

const findField = (c: CollectionConfig, name: string) =>
  c.fields.find((f) => 'name' in f && f.name === name) as Record<string, unknown> | undefined

const accessArgs = (role?: AccountRole) =>
  ({ req: { user: role ? { id: 'u1', collection: 'users', role } : null } }) as never

describe('classroom collections contract', () => {
  it('keeps the slugs Web reads', () => {
    expect(Schools.slug).toBe('schools')
    expect(Classes.slug).toBe('classes')
    expect(QuestionAttempts.slug).toBe('question-attempts')
  })

  it('keeps the field names Web reads', () => {
    expect(fieldNames(Schools)).toEqual(['name', 'tenant'])
    expect(fieldNames(Classes)).toEqual([
      'name',
      'school',
      'course',
      'teachers',
      'students',
      'tenant',
    ])
    expect(fieldNames(QuestionAttempts)).toEqual([
      'tenant',
      'user',
      'lesson',
      'exercise',
      'block',
      'solved',
      'wrongCount',
      'hintCount',
      'explanationCount',
      'firstAttemptAt',
      'solvedAt',
    ])
  })

  it('limits class teachers to teacher-role users', () => {
    expect(findField(Classes, 'teachers')?.filterOptions).toEqual({
      role: { equals: AccountRole.Teacher },
    })
  })

  it('indexes question-attempts by user and lesson', () => {
    expect(findField(QuestionAttempts, 'user')?.index).toBe(true)
    expect(findField(QuestionAttempts, 'lesson')?.index).toBe(true)
  })

  it.each([Schools, Classes])('$slug is admin-only for every operation', (collection) => {
    const access = collection.access!
    for (const op of ['create', 'read', 'update', 'delete'] as const) {
      const fn = access[op] as (args: never) => boolean
      expect(fn(accessArgs(AccountRole.Admin))).toBe(true)
      expect(fn(accessArgs(AccountRole.Teacher))).toBe(false)
      expect(fn(accessArgs(AccountRole.Student))).toBe(false)
      expect(fn(accessArgs())).toBe(false)
    }
  })

  it('question-attempts cannot be created or edited through Payload', () => {
    const access = QuestionAttempts.access!
    const call = (op: 'create' | 'update') =>
      (access[op] as (args: never) => boolean)(accessArgs(AccountRole.Admin))
    expect(call('create')).toBe(false)
    expect(call('update')).toBe(false)
  })
})

describe('normalizeRelationshipIds', () => {
  const hook = normalizeRelationshipIds(['school', 'teachers', 'course'])

  it('collapses populated single and hasMany relationships to IDs without mutating', () => {
    const doc = {
      id: 'c1',
      school: { id: 's1', name: 'X' },
      teachers: [{ id: 'u1' }, 'u2'],
      course: 'k1',
    }
    const result = hook({ doc } as never)
    expect(result).toEqual({ id: 'c1', school: 's1', teachers: ['u1', 'u2'], course: 'k1' })
    expect(doc.school).toEqual({ id: 's1', name: 'X' })
  })

  it('leaves missing and null fields alone', () => {
    expect(hook({ doc: { id: 'c1', school: null } } as never)).toEqual({ id: 'c1', school: null })
  })
})
