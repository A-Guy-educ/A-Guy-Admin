/**
 * `user-learning-states` is written directly to Mongo by A-Guy-Web, which
 * upserts on { user, kind, key }. The collection name, field names and the
 * unique compound index are a cross-repo contract.
 */
import { describe, expect, it } from 'vitest'
import type { Field } from 'payload'

import { UserLearningStates } from '@/server/payload/collections/UserLearningStates'
import { AccountRole } from '@/server/payload/collections/Users/roles'

const findField = (name: string) =>
  UserLearningStates.fields.find((f) => 'name' in f && f.name === name) as
    | (Field & Record<string, unknown>)
    | undefined

const accessArgs = (role?: AccountRole) =>
  ({ req: { user: role ? { id: 'u1', collection: 'users', role } : null } }) as never

describe('UserLearningStates collection', () => {
  it('maps to the exact Mongo collection Web writes', () => {
    expect(UserLearningStates.slug).toBe('user-learning-states')
    expect(UserLearningStates.dbName).toBe('user-learning-states')
    expect(UserLearningStates.timestamps).toBe(true)
  })

  it('keeps the field contract Web writes', () => {
    expect(findField('user')).toMatchObject({
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    })
    expect(findField('kind')).toMatchObject({ type: 'select', required: true })
    expect((findField('kind')?.options as { value: string }[]).map((o) => o.value)).toEqual([
      'exercise',
      'lesson-chat',
    ])
    expect(findField('key')).toMatchObject({ type: 'text', required: true })
    expect(findField('tenant')).toMatchObject({ type: 'relationship', relationTo: 'tenants' })
  })

  it('keeps state opaque', () => {
    const state = findField('state')
    expect(state).toMatchObject({ type: 'json' })
    expect(state).not.toHaveProperty('validate')
    expect(state).not.toHaveProperty('hooks')
    expect(state).not.toHaveProperty('jsonSchema')
    expect(UserLearningStates.hooks).toBeUndefined()
  })

  it('has a unique compound index on user + kind + key', () => {
    expect(UserLearningStates.indexes).toEqual([{ fields: ['user', 'kind', 'key'], unique: true }])
  })

  describe('access', () => {
    const access = UserLearningStates.access!

    it('lets admins read everything and students read only their own docs', () => {
      expect(access.read!(accessArgs(AccountRole.Admin))).toBe(true)
      expect(access.read!(accessArgs(AccountRole.Student))).toEqual({
        user: { equals: 'u1' },
      })
      expect(access.read!(accessArgs())).toBe(false)
    })

    it.each(['create', 'update', 'delete'] as const)('restricts %s to admins', (op) => {
      expect(access[op]!(accessArgs(AccountRole.Admin))).toBe(true)
      expect(access[op]!(accessArgs(AccountRole.Student))).toBe(false)
      expect(access[op]!(accessArgs())).toBe(false)
    })
  })
})
