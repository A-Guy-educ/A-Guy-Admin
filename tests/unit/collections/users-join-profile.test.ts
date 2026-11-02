/**
 * Join-profile fields on Users are written by A-Guy-Web's /join page via the
 * raw Mongo driver, so field names are a cross-repo contract. Phone is PII.
 */
import { describe, expect, it } from 'vitest'
import type { FieldAccess } from 'payload'

import { Users } from '@/server/payload/collections/Users'
import { AccountRole } from '@/server/payload/collections/Users/roles'
import { validateIsraeliMobile } from '@/server/payload/collections/Users/userJoinProfile'

type AccessField = {
  name: string
  type: string
  options?: { value: string }[]
  access?: { read?: FieldAccess; create?: FieldAccess; update?: FieldAccess }
  admin?: { readOnly?: boolean; position?: string }
  virtual?: boolean
}

const findField = (name: string) =>
  Users.fields.find((f) => 'name' in f && f.name === name) as AccessField | undefined

const args = (role: AccountRole | null, docId = 'other') =>
  ({
    req: { user: role ? { id: 'u1', collection: 'users', role } : null },
    doc: { id: docId },
  }) as never

const NON_ADMINS = [AccountRole.Student, AccountRole.Teacher, AccountRole.AdvancedContentEditor]

describe('Users join-profile fields', () => {
  it('declares the stored fields Web writes', () => {
    for (const name of ['firstName', 'lastName', 'phone', 'onboardingType']) {
      const field = findField(name)
      expect(field, name).toBeDefined()
      expect(field?.virtual, name).toBeFalsy()
    }
    expect(findField('onboardingType')?.options?.map((o) => o.value)).toEqual(['b2b', 'b2c'])
  })

  it('keeps onboardingType separate from the derived segment field', () => {
    expect(findField('segment')?.virtual).toBe(true)
    expect(findField('onboardingType')?.virtual).toBeFalsy()
  })

  it('shows the new fields in the list view', () => {
    expect(Users.admin?.defaultColumns).toEqual(
      expect.arrayContaining(['firstName', 'lastName', 'phone']),
    )
  })

  describe('phone read access (PII)', () => {
    const read = findField('phone')?.access?.read as FieldAccess

    it('allows admins to read any user', () => {
      expect(read(args(AccountRole.Admin))).toBe(true)
    })

    it('allows a user to read their own phone', () => {
      expect(read(args(AccountRole.Student, 'u1'))).toBe(true)
    })

    it.each(NON_ADMINS)('denies %s reading another user', (role) => {
      expect(read(args(role, 'other'))).toBe(false)
    })

    it('denies anonymous readers', () => {
      expect(read(args(null, 'u1'))).toBe(false)
    })
  })

  describe.each(['firstName', 'lastName', 'phone'])('%s write access', (name) => {
    const access = findField(name)?.access

    it('allows admins to create and update', () => {
      expect(access?.create?.(args(AccountRole.Admin))).toBe(true)
      expect(access?.update?.(args(AccountRole.Admin))).toBe(true)
    })

    it('blocks non-admins, including self-update and anonymous signup', () => {
      for (const role of [...NON_ADMINS, null]) {
        expect(access?.create?.(args(role, 'u1'))).toBe(false)
        expect(access?.update?.(args(role, 'u1'))).toBe(false)
      }
    })
  })

  it('never lets REST/GraphQL write onboardingType, even for admins', () => {
    const field = findField('onboardingType')
    for (const role of [AccountRole.Admin, AccountRole.Student, null]) {
      expect(field?.access?.create?.(args(role, 'u1'))).toBe(false)
      expect(field?.access?.update?.(args(role, 'u1'))).toBe(false)
    }
    expect(field?.admin?.readOnly).toBe(true)
    expect(field?.admin?.position).toBe('sidebar')
  })

  describe('validateIsraeliMobile', () => {
    it.each([undefined, null, '', '0501234567', '0549876543'])('accepts %s', (value) => {
      expect(validateIsraeliMobile(value)).toBe(true)
    })

    it.each(['050-1234567', '+972501234567', '050123456', '0401234567', 501234567])(
      'rejects %s',
      (value) => {
        expect(validateIsraeliMobile(value)).toEqual(expect.any(String))
      },
    )
  })
})
