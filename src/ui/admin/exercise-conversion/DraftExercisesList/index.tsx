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
      <div
        style={{
          marginTop: 4,
          padding: 8,
          backgroundColor: 'var(--theme-elevation-50)',
          borderRadius: 4,
          color: 'var(--theme-elevation-500)',
          fontSize: 11,
        }}
      >
        Loading exercises...
      </div>
    )
  }

  if (exercises.length === 0) {
    return (
      <div
        style={{
          marginTop: 4,
          padding: 8,
          backgroundColor: 'var(--theme-elevation-50)',
          borderRadius: 4,
        }}
      >
        <p
          style={{
            fontSize: 11,
            color: 'var(--theme-elevation-500)',
          }}
        >
          No draft exercises found for this conversion.
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        marginTop: 4,
        padding: 8,
        backgroundColor: 'var(--theme-elevation-50)',
        borderRadius: 4,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--theme-elevation-700)',
          marginBottom: 8,
          display: 'block',
        }}
      >
        Draft Exercises ({exercises.length})
      </span>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
        }}
      >
        {exercises.map((exercise) => (
          <li key={exercise.id} style={{ marginBottom: 4 }}>
            <button
              onClick={() => router.push(`/admin/collections/exercises/${exercise.id}`)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '2px 0',
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--theme-elevation-700)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {exercise.title}
              {exercise.sourcePageStart && exercise.sourcePageEnd && (
                <span
                  style={{
                    color: 'var(--theme-elevation-400)',
                    fontSize: 10,
                    marginLeft: 4,
                  }}
                >
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
