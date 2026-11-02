/**
 * User segment (B2B / B2C) — derived, never stored.
 *
 * A user is B2B if they appear in any `classes` doc's `students[]` or
 * `teachers[]`; otherwise B2C. A-Guy-Web derives the same thing for the Dash
 * metrics, so keep the definition in sync with Web. Independent of `role`:
 * a B2C user can still hold the teacher role.
 *
 * @fileType constants
 * @domain classroom
 * @ai-summary B2B/B2C segment enum, labels, and list-view query param
 */

import type { PayloadRequest } from 'payload'

import { isUsersCollectionUser } from '@/server/payload/access/isUsersCollectionUser'
import { AccountRole } from './roles'

export const UserSegment = {
  B2B: 'b2b',
  B2C: 'b2c',
} as const

export type UserSegment = (typeof UserSegment)[keyof typeof UserSegment]

export const USER_SEGMENT_LABEL: Record<UserSegment, string> = {
  [UserSegment.B2B]: 'B2B',
  [UserSegment.B2C]: 'B2C',
}

/** URL param read by the Users list view's base filter (`?segment=b2b`). */
export const USER_SEGMENT_QUERY_PARAM = 'segment'

export const parseUserSegment = (value: unknown): UserSegment | null =>
  value === UserSegment.B2B || value === UserSegment.B2C ? value : null

/**
 * Class membership is admin-only data (Classes/Schools access is adminOnly),
 * so only admins get the derived fields and the segment filter.
 */
export const canSeeUserSegment = (req: PayloadRequest): boolean =>
  isUsersCollectionUser(req.user) && req.user.role === AccountRole.Admin
