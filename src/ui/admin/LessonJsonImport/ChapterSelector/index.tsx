'use client'

import { useDebounce } from '@/client/hooks/useDebounce'
import { useEffect, useRef, useState } from 'react'

import {
  dropdownStyle,
  fieldGroupStyle,
  inputStyle,
  labelStyle,
} from '@/ui/admin/PdfConversion/styles'

interface ChapterOption {
  id: string
  title: string
  courseTitle?: string
}

interface ChapterSelectorProps {
  selectedChapterId: string | null
  onSelectChapter: (chapter: ChapterOption) => void
}

const containerStyle: React.CSSProperties = { position: 'relative' }

const itemStyle: React.CSSProperties = {
  padding: '8px 12px',
  cursor: 'pointer',
  fontSize: 13,
}

const itemHoverStyle: React.CSSProperties = {
  ...itemStyle,
  backgroundColor: 'var(--theme-elevation-100)',
}

const selectedStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--theme-elevation-600)',
  marginTop: 4,
}

interface ChapterDoc {
  id: string
  title?: string
  chapterLabel?: string
  course?: { id: string; title?: string } | string
}

export function ChapterSelector({ selectedChapterId, onSelectChapter }: ChapterSelectorProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChapterOption[]>([])
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(-1)
  const [selectedLabel, setSelectedLabel] = useState('')
  const debounced = useDebounce(query, 250)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function fetchAll() {
      try {
        const url = debounced
          ? `/api/chapters?where[title][contains]=${encodeURIComponent(debounced)}&limit=20&depth=1`
          : `/api/chapters?limit=20&depth=1`
        const res = await fetch(url, { credentials: 'include', signal: controller.signal })
        if (!res.ok) return
        const data = await res.json()
        const docs: ChapterDoc[] = data.docs || []
        setResults(
          docs.map((d) => ({
            id: d.id,
            title: d.title || d.chapterLabel || 'Untitled',
            courseTitle:
              typeof d.course === 'object' && d.course ? d.course.title : undefined,
          })),
        )
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        // silent — user can retry by typing
      }
    }
    fetchAll()
    return () => controller.abort()
  }, [debounced])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div style={fieldGroupStyle}>
      <label style={labelStyle}>Target chapter</label>
      <div ref={ref} style={containerStyle}>
        <input
          style={inputStyle}
          placeholder="Search chapters…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
        {open && results.length > 0 && (
          <ul style={dropdownStyle}>
            {results.map((c, idx) => (
              <li
                key={c.id}
                style={hover === idx ? itemHoverStyle : itemStyle}
                onMouseEnter={() => setHover(idx)}
                onMouseLeave={() => setHover(-1)}
                onClick={() => {
                  onSelectChapter(c)
                  setSelectedLabel(
                    c.courseTitle ? `${c.courseTitle} → ${c.title}` : c.title,
                  )
                  setQuery('')
                  setOpen(false)
                }}
              >
                <div style={{ fontWeight: 500 }}>{c.title}</div>
                {c.courseTitle && (
                  <div style={{ fontSize: 12, color: 'var(--theme-elevation-500)' }}>
                    {c.courseTitle}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {selectedChapterId && selectedLabel && (
          <div style={selectedStyle}>Selected: {selectedLabel}</div>
        )}
      </div>
    </div>
  )
}
