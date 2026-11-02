'use client'

/**
 * B2B / B2C filter above the Users list table. Sets the `?segment=` URL param,
 * which the Users `baseListFilter` turns into a class-membership id filter
 * (Payload can't filter on virtual fields natively).
 */

import { useListQuery, useTranslation } from '@payloadcms/ui'
import React from 'react'

import {
  parseUserSegment,
  USER_SEGMENT_LABEL,
  USER_SEGMENT_QUERY_PARAM,
  UserSegment,
} from '@/server/payload/collections/Users/userSegment'

const STRINGS = {
  en: { label: 'Segment:', all: 'All' },
  he: { label: 'פלח:', all: 'הכל' },
} as const

const OPTIONS = [null, UserSegment.B2B, UserSegment.B2C] as const

export const UserSegmentFilter: React.FC = () => {
  const { i18n } = useTranslation()
  const { query, refineListData } = useListQuery()
  const s = i18n.language === 'he' ? STRINGS.he : STRINGS.en
  const active = parseUserSegment(query?.[USER_SEGMENT_QUERY_PARAM])

  const select = (segment: UserSegment | null) => {
    if (segment === active) return
    void refineListData({ [USER_SEGMENT_QUERY_PARAM]: segment ?? undefined, page: 1 })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 13, color: 'var(--theme-elevation-600)' }}>{s.label}</span>
      {OPTIONS.map((segment) => {
        const isActive = segment === active
        return (
          <button
            key={segment ?? 'all'}
            type="button"
            aria-pressed={isActive}
            onClick={() => select(segment)}
            style={{
              padding: '4px 12px',
              fontSize: 13,
              borderRadius: 4,
              cursor: 'pointer',
              border: '1px solid var(--theme-elevation-150)',
              backgroundColor: isActive ? 'var(--theme-elevation-800)' : 'var(--theme-elevation-0)',
              color: isActive ? 'var(--theme-elevation-0)' : 'var(--theme-elevation-800)',
            }}
          >
            {segment ? USER_SEGMENT_LABEL[segment] : s.all}
          </button>
        )
      })}
    </div>
  )
}

export default UserSegmentFilter
