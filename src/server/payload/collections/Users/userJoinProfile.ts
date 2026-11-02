/**
 * Join-profile fields on Users: first/last name, mobile, and onboarding type.
 *
 * Written by A-Guy-Web's /join page (students joining through their school)
 * straight to the `users` Mongo collection after Google sign-in — raw driver,
 * not Payload REST. Declared here so admins can see/edit them and so Payload's
 * full-doc save on admin edits doesn't drop them. Field names are a cross-repo
 * contract with Web (A-Guy-Web#1541).
 *
 * `onboardingType` records *how* the user signed up; it is separate from the
 * derived `segment` (class membership) — see ./userSegment.ts.
 *
 * @fileType collection-fields
 * @domain auth
 * @ai-summary Users join-profile fields (firstName, lastName, phone, onboardingType) and access
 */

import type { FieldAccess, TextField, SelectField } from 'payload'

import { isUsersCollectionUser } from '@/server/payload/access/isUsersCollectionUser'
import { AccountRole } from './roles'

export const OnboardingType = {
  B2B: 'b2b',
  B2C: 'b2c',
} as const

export type OnboardingType = (typeof OnboardingType)[keyof typeof OnboardingType]

export const ONBOARDING_TYPE_LABEL: Record<OnboardingType, string> = {
  [OnboardingType.B2B]: 'B2B',
  [OnboardingType.B2C]: 'B2C',
}

/** Israeli mobile, digits only — the format Web stores. */
const IL_MOBILE_RE = /^05\d{8}$/

export const validateIsraeliMobile = (value: unknown): true | string => {
  if (value == null || value === '') return true
  if (typeof value !== 'string' || !IL_MOBILE_RE.test(value)) {
    return 'Must be an Israeli mobile number, digits only (05XXXXXXXX)'
  }
  return true
}

export const adminOnlyField: FieldAccess = ({ req: { user } }) =>
  isUsersCollectionUser(user) && user.role === AccountRole.Admin

/** Phone is PII: readable by admins and by the user themselves only. */
export const adminOrSelfField: FieldAccess = ({ req: { user }, doc }) => {
  if (!isUsersCollectionUser(user)) return false
  if (user.role === AccountRole.Admin) return true
  return doc?.id != null && String(doc.id) === String(user.id)
}

// Create/update are admin-only: Web writes these via the raw driver, so the
// public signup POST and self-PATCH have no reason to set them.
const firstName: TextField = {
  name: 'firstName',
  label: { en: 'First name', he: 'שם פרטי' },
  type: 'text',
  maxLength: 100,
  access: { create: adminOnlyField, update: adminOnlyField },
}

const lastName: TextField = {
  name: 'lastName',
  label: { en: 'Last name', he: 'שם משפחה' },
  type: 'text',
  maxLength: 100,
  access: { create: adminOnlyField, update: adminOnlyField },
}

const phone: TextField = {
  name: 'phone',
  label: { en: 'Phone', he: 'טלפון' },
  type: 'text',
  validate: validateIsraeliMobile,
  access: { read: adminOrSelfField, create: adminOnlyField, update: adminOnlyField },
}

// Set only by Web's /join. Blocked from REST/GraphQL create+update (like
// signupSource) so the public signup POST / self-update can't forge it.
const onboardingType: SelectField = {
  name: 'onboardingType',
  label: { en: 'Onboarding type', he: 'סוג הצטרפות' },
  type: 'select',
  options: Object.entries(ONBOARDING_TYPE_LABEL).map(([value, label]) => ({ label, value })),
  access: { create: () => false, update: () => false },
  admin: {
    readOnly: true,
    position: 'sidebar',
    description:
      'Set to B2B when the student joined through their school (/join). Empty = regular B2C onboarding.',
  },
}

export const userJoinProfileFields = [firstName, lastName, phone, onboardingType]
