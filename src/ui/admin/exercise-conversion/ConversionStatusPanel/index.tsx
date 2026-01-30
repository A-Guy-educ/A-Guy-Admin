'use client'

import { useEffect, useState } from 'react'

interface JobStatus {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  output?: {
    segmentsTotal: number
    segmentsDone: number
    segmentsFailed: number
    exercisesCreated: number
    exercisesDeduped: number
    errors: Array<{
      stage: string
      code: string
      message: string
    }>
  }
  updatedAt: string
}

interface ConversionStatusPanelProps {
  lessonId: string
  mediaId: string
  onViewExercises?: () => void
}

// Badge color styles based on status
const badgeColors = {
  queued: 'background-color: var(--theme-warning-100); color: var(--theme-warning-500);',
  running: 'background-color: var(--theme-info-100); color: var(--theme-info-500);',
  completed: 'background-color: var(--theme-success-100); color: var(--theme-success-500);',
  failed: 'background-color: var(--theme-error-100); color: var(--theme-error-500);',
}

export function ConversionStatusPanel({
  lessonId,
  mediaId,
  onViewExercises,
}: ConversionStatusPanelProps) {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch(
          `/api/exercises/convert/status?lessonId=${lessonId}&mediaId=${mediaId}&limit=1`,
          { credentials: 'include' },
        )

        if (!response.ok) {
          setStatus(null)
          return
        }

        const data = await response.json()
        if (data.docs && data.docs.length > 0) {
          setStatus(data.docs[0])
        } else {
          setStatus(null)
        }
      } catch {
        setStatus(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [lessonId, mediaId])

  const handleRunNow = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!status?.id) return

    setIsRunning(true)
    try {
      const response = await fetch('/api/jobs/run-immediate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jobId: status.id }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      // Refresh status
      setStatus(null)
      setIsLoading(true)
    } catch (error) {
      console.error('[ConversionStatusPanel] Error:', error)
      alert(`Failed to run job: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsRunning(false)
    }
  }

  if (isLoading) {
    return (
      <div
        style={{
          padding: '0.75rem',
          borderRadius: '4px',
          background: 'var(--theme-elevation-100)',
          color: 'var(--theme-elevation-500)',
        }}
      >
        Loading status...
      </div>
    )
  }

  if (!status) {
    return null
  }

  const progress = status.output?.segmentsTotal
    ? Math.round((status.output.segmentsDone / status.output.segmentsTotal) * 100)
    : 0

  const canRun = status.status === 'queued' || status.status === 'failed'

  return (
    <div
      style={{
        padding: '0.75rem',
        borderRadius: '4px',
        background: 'var(--theme-elevation-100)',
        marginTop: '0.5rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.5rem',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Conversion Status</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              ...Object.fromEntries(
                badgeColors[status.status]
                  .split('; ')
                  .filter(Boolean)
                  .map((s) => {
                    const [key, value] = s.split(': ')
                    return [key, value]
                  }),
              ),
            }}
          >
            {status.status}
          </span>
          {canRun && (
            <button
              type="button"
              style={{
                padding: '4px 12px',
                borderRadius: '4px',
                fontWeight: 500,
                cursor: isRunning ? 'not-allowed' : 'pointer',
                background: 'var(--theme-elevation-150)',
                color: 'var(--theme-text)',
                border: 'none',
                opacity: isRunning ? 0.5 : 1,
              }}
              onClick={handleRunNow}
              disabled={isRunning}
            >
              {isRunning ? 'Running...' : '▶ Run Now'}
            </button>
          )}
        </div>
      </div>

      {status.status === 'running' && (
        <div
          style={{
            height: '8px',
            background: 'var(--theme-elevation-200)',
            borderRadius: '4px',
            overflow: 'hidden',
            marginBottom: '0.5rem',
          }}
        >
          <div
            style={{
              height: '100%',
              background: 'var(--theme-success-500)',
              width: `${progress}%`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
        {status.output && (
          <>
            <div>
              <span style={{ color: 'var(--theme-elevation-500)', marginRight: '0.25rem' }}>
                Segments
              </span>
              <span>
                {status.output.segmentsDone} / {status.output.segmentsTotal}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--theme-elevation-500)', marginRight: '0.25rem' }}>
                Exercises
              </span>
              <span>
                {status.output.exercisesCreated} created
                {status.output.exercisesDeduped > 0 &&
                  ` (${status.output.exercisesDeduped} deduped)`}
              </span>
            </div>
          </>
        )}
      </div>

      {status.status === 'completed' && onViewExercises && (
        <button
          style={{
            marginTop: '0.75rem',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            fontWeight: 500,
            cursor: 'pointer',
            background: 'var(--theme-elevation-150)',
            color: 'var(--theme-text)',
            border: 'none',
          }}
          onClick={onViewExercises}
        >
          View Created Exercises
        </button>
      )}
    </div>
  )
}
