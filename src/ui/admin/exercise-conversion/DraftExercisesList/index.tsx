'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface DraftExercisesListProps {
  lessonId: string
  sourceDocId: string
}

interface Exercise {
  id: string
  title: string
  status: string
  origin: string
  sourcePageStart?: number
  sourcePageEnd?: number
  sourceOrderInSegment?: number
}

const listStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.75rem',
  background: 'var(--theme-elevation-50)',
  borderRadius: '4px',
}

const listHeaderStyle: React.CSSProperties = {
  margin: '0 0 0.5rem 0',
  fontSize: '0.9rem',
}

const listStyleObj: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
}

const listItemStyle: React.CSSProperties = {
  marginBottom: '0.25rem',
}

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--theme-text)',
  cursor: 'pointer',
  textAlign: 'left',
  padding: '0.25rem 0',
  width: '100%',
}

const pageRangeStyle: React.CSSProperties = {
  color: 'var(--theme-elevation-400)',
  fontSize: '0.85rem',
}

export function DraftExercisesList({ lessonId, sourceDocId }: DraftExercisesListProps) {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function fetchExercises() {
      try {
        const where = encodeURIComponent(
          JSON.stringify({
            and: [
              { lesson: { equals: lessonId } },
              { sourceDoc: { equals: sourceDocId } },
              { origin: { equals: 'conversion' } },
              { status: { equals: 'draft' } },
            ],
          }),
        )

        const response = await fetch(
          `/api/exercises?where=${where}&limit=100&sort=sourceOrderInSegment`,
          { credentials: 'include' },
        )
        if (response.ok) {
          const data = await response.json()
          setExercises(data.docs || [])
        }
      } catch (err) {
        console.error('Failed to fetch exercises:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchExercises()
  }, [lessonId, sourceDocId])

  if (isLoading) {
    return (
      <div style={{ ...listStyle, color: 'var(--theme-elevation-500)' }}>Loading exercises...</div>
    )
  }

  if (exercises.length === 0) {
    return (
      <div style={listStyle}>
        <p>No draft exercises found for this conversion.</p>
      </div>
    )
  }

  return (
    <div style={listStyle}>
      <h3 style={listHeaderStyle}>Draft Exercises ({exercises.length})</h3>
      <ul style={listStyleObj}>
        {exercises.map((exercise) => (
          <li key={exercise.id} style={listItemStyle}>
            <button
              style={linkStyle}
              onClick={() => router.push(`/admin/collections/exercises/${exercise.id}`)}
            >
              {exercise.title}
              {exercise.sourcePageStart && exercise.sourcePageEnd && (
                <span style={pageRangeStyle}>
                  {' '}
                  (Pages {exercise.sourcePageStart}-{exercise.sourcePageEnd})
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
