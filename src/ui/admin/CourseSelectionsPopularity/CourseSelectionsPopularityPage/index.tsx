'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { COURSE_SELECTION_SOURCES } from '@/server/payload/collections/CourseSelections'

const SOURCE_OPTIONS = COURSE_SELECTION_SOURCES.map((s) => ({
  value: s,
  label:
    s === 'start-page'
      ? 'Start Page'
      : s === 'homepage-greeting'
        ? 'Homepage Greeting'
        : s === 'course-card'
          ? 'Course Card'
          : 'Other',
}))

type SortKey = 'courseTitle' | 'totalPicks' | 'uniqueGuests' | 'uniqueUsers' | 'last7d' | 'last30d'

type SortDir = 'asc' | 'desc'

interface PopularityRow {
  courseId: string
  courseTitle: string
  totalPicks: number
  uniqueGuests: number
  uniqueUsers: number
  last7d: number
  last30d: number
}

interface PopularityResponse {
  rows: PopularityRow[]
  filters: { gradeLevel?: string; source?: string }
}

const pageStyle: React.CSSProperties = {
  padding: 'calc(var(--base) * 1.5)',
  maxWidth: 1400,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'calc(var(--base) * 0.75)',
  marginBottom: 'calc(var(--base) * 1.25)',
  paddingBottom: 'calc(var(--base) * 1.25)',
  borderBottom: '1px solid var(--theme-elevation-150)',
}

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--theme-text)',
  margin: 0,
}

const filtersBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  marginBottom: 16,
  padding: 12,
  backgroundColor: 'var(--theme-elevation-50)',
  border: '1px solid var(--theme-elevation-200)',
  borderRadius: 8,
}

const filterFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 200,
}

const filterLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--theme-elevation-600)',
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid var(--theme-elevation-300)',
  borderRadius: 4,
  backgroundColor: 'var(--theme-elevation-0)',
  color: 'var(--theme-text)',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  backgroundColor: 'var(--theme-elevation-0)',
  border: '1px solid var(--theme-elevation-200)',
  borderRadius: 8,
  overflow: 'hidden',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid var(--theme-elevation-200)',
  backgroundColor: 'var(--theme-elevation-50)',
  color: 'var(--theme-elevation-700)',
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

const thNumericStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: 'right',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  color: 'var(--theme-elevation-1000)',
  verticalAlign: 'top',
}

const tdNumericStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}

const sortArrow = (key: SortKey, current: SortKey, dir: SortDir) => {
  if (key !== current) return ''
  return dir === 'asc' ? ' ▲' : ' ▼'
}

const compareRows = (a: PopularityRow, b: PopularityRow, key: SortKey, dir: SortDir) => {
  const sign = dir === 'asc' ? 1 : -1
  if (key === 'courseTitle') {
    return a.courseTitle.localeCompare(b.courseTitle) * sign
  }
  const av = a[key]
  const bv = b[key]
  if (av === bv) return 0
  return (av < bv ? -1 : 1) * sign
}

export function CourseSelectionsPopularityPage() {
  const [data, setData] = useState<PopularityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [gradeLevel, setGradeLevel] = useState<string>('')
  const [source, setSource] = useState<string>('')

  const [sortKey, setSortKey] = useState<SortKey>('totalPicks')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (gradeLevel) params.set('gradeLevel', gradeLevel)
      if (source) params.set('source', source)
      const qs = params.toString()
      const url = `/api/course-selections/popularity${qs ? `?${qs}` : ''}`

      const res = await fetch(url, { credentials: 'include' })
      if (res.status === 401 || res.status === 403) {
        setError('Admin access required')
        return
      }
      if (!res.ok) {
        throw new Error(`Failed to fetch popularity: ${res.status}`)
      }
      const json = (await res.json()) as PopularityResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [gradeLevel, source])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const sortedRows = useMemo(() => {
    if (!data) return []
    return [...data.rows].sort((a, b) => compareRows(a, b, sortKey, sortDir))
  }, [data, sortKey, sortDir])

  const gradeLevels = useMemo(() => {
    const set = new Set<string>()
    if (data) {
      // gradeLevel filter source is the collection itself; we don't fetch
      // the full distinct list, so the page just allows free-text input.
      // Keep the field free-text — see issue #246 non-goals.
      void set
    }
    return []
  }, [data])

  const onHeaderClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'courseTitle' ? 'asc' : 'desc')
    }
  }

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Course Popularity</h1>
      </div>

      <div style={filtersBarStyle}>
        <div style={filterFieldStyle}>
          <label style={filterLabelStyle} htmlFor="filter-grade">
            Grade level
          </label>
          <input
            id="filter-grade"
            style={inputStyle}
            type="text"
            value={gradeLevel}
            placeholder="e.g. 10"
            onChange={(e) => setGradeLevel(e.target.value)}
            list={gradeLevels.length > 0 ? 'grade-level-options' : undefined}
          />
        </div>
        <div style={filterFieldStyle}>
          <label style={filterLabelStyle} htmlFor="filter-source">
            Source
          </label>
          <select
            id="filter-source"
            style={inputStyle}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          style={{
            ...inputStyle,
            cursor: 'pointer',
            fontWeight: 500,
            backgroundColor: 'var(--theme-elevation-100)',
          }}
          onClick={() => {
            setGradeLevel('')
            setSource('')
          }}
        >
          Clear
        </button>
      </div>

      {loading && (
        <div style={{ padding: 20, color: 'var(--theme-elevation-500)' }}>Loading...</div>
      )}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--theme-error-100)',
            color: 'var(--theme-error)',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle} onClick={() => onHeaderClick('courseTitle')}>
                Course{sortArrow('courseTitle', sortKey, sortDir)}
              </th>
              <th style={thNumericStyle} onClick={() => onHeaderClick('totalPicks')}>
                Total Picks{sortArrow('totalPicks', sortKey, sortDir)}
              </th>
              <th style={thNumericStyle} onClick={() => onHeaderClick('uniqueGuests')}>
                Unique Guests{sortArrow('uniqueGuests', sortKey, sortDir)}
              </th>
              <th style={thNumericStyle} onClick={() => onHeaderClick('uniqueUsers')}>
                Unique Users{sortArrow('uniqueUsers', sortKey, sortDir)}
              </th>
              <th style={thNumericStyle} onClick={() => onHeaderClick('last7d')}>
                Last 7d{sortArrow('last7d', sortKey, sortDir)}
              </th>
              <th style={thNumericStyle} onClick={() => onHeaderClick('last30d')}>
                Last 30d{sortArrow('last30d', sortKey, sortDir)}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={6}>
                  No courses have selections matching the current filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr key={row.courseId}>
                  <td style={tdStyle}>{row.courseTitle}</td>
                  <td style={tdNumericStyle}>{row.totalPicks}</td>
                  <td style={tdNumericStyle}>{row.uniqueGuests}</td>
                  <td style={tdNumericStyle}>{row.uniqueUsers}</td>
                  <td style={tdNumericStyle}>{row.last7d}</td>
                  <td style={tdNumericStyle}>{row.last30d}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default CourseSelectionsPopularityPage
