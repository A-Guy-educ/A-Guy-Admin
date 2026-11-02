/**
 * Users list-view base filter for the B2B / B2C segment.
 *
 * Payload can't filter on `virtual: true` fields (the WhereBuilder hides
 * them and query validation rejects them), so the segment filter is a custom
 * `?segment=b2b|b2c` URL param set by the SegmentFilter list component.
 * Payload passes the parsed URL query as `req.query`; we translate the param
 * into an `id in / not_in` constraint over all class members.
 *
 * @fileType collection-config
 * @domain classroom
 * @ai-summary baseListFilter translating ?segment= into a class-membership id filter
 */

import type { BaseListFilter } from 'payload'

import { findAllClassMemberIds } from './classMembership'
import {
  canSeeUserSegment,
  parseUserSegment,
  USER_SEGMENT_QUERY_PARAM,
  UserSegment,
} from './userSegment'

export const userSegmentListFilter: BaseListFilter = async ({ req }) => {
  const segment = parseUserSegment(req.query?.[USER_SEGMENT_QUERY_PARAM])
  if (!segment || !canSeeUserSegment(req)) return null

  const memberIds = await findAllClassMemberIds(req)
  return segment === UserSegment.B2B ? { id: { in: memberIds } } : { id: { not_in: memberIds } }
}
