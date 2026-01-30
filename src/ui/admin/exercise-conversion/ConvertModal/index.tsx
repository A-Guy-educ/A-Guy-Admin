'use client'

import { useEffect, useState } from 'react'

interface ConvertModalProps {
  lessonId: string
  mediaId: string
  filename: string
  onClose: () => void
}

interface PromptOption {
  id: string
  title: string
  key: string
  type: string
  usage: string
}

// Modal overlay styles
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

// Modal content styles
const contentStyle: React.CSSProperties = {
  background: 'var(--theme-elevation-0)',
  padding: '1.5rem',
  borderRadius: '8px',
  width: '100%',
  maxWidth: '500px',
  maxHeight: '90vh',
  overflowY: 'auto',
}

const filenameStyle: React.CSSProperties = {
  color: 'var(--theme-elevation-500)',
  marginBottom: '1rem',
}

const errorBannerStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: 'var(--theme-error-100)',
  color: 'var(--theme-error-500)',
  borderRadius: '4px',
  marginBottom: '1rem',
}

const successBannerStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: 'var(--theme-success-100)',
  color: 'var(--theme-success-500)',
  borderRadius: '4px',
  marginBottom: '1rem',
}

const formFieldStyle: React.CSSProperties = {
  marginBottom: '1rem',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.25rem',
  fontWeight: 500,
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: '4px',
  background: 'var(--theme-elevation-0)',
}

const formActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  justifyContent: 'flex-end',
  marginTop: '1.5rem',
}

const buttonSecondaryStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '4px',
  fontWeight: 500,
  cursor: 'pointer',
  background: 'var(--theme-elevation-150)',
  color: 'var(--theme-text)',
  border: 'none',
}

const buttonPrimaryStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: '4px',
  fontWeight: 500,
  cursor: 'pointer',
  background: 'var(--theme-elevation-900)',
  color: 'var(--theme-elevation-0)',
  border: 'none',
}

export function ConvertModal({ lessonId, mediaId, filename, onClose }: ConvertModalProps) {
  const [extractorPrompts, setExtractorPrompts] = useState<PromptOption[]>([])
  const [verifierPrompts, setVerifierPrompts] = useState<PromptOption[]>([])
  const [selectedExtractor, setSelectedExtractor] = useState<string>('')
  const [selectedVerifier, setSelectedVerifier] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    async function loadPrompts() {
      try {
        // Fetch prompts with overrideAccess: true via internal API
        const response = await fetch('/api/prompts/for-conversion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId }),
          credentials: 'include',
        })

        if (!response.ok) {
          throw new Error('Failed to load prompts')
        }

        const data = await response.json()
        setExtractorPrompts(data.extractors || [])
        setVerifierPrompts(data.verifiers || [])
      } catch (_err) {
        setError('Failed to load prompts')
      } finally {
        setIsLoading(false)
      }
    }

    loadPrompts()
  }, [lessonId])

  async function handleSubmit() {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/exercises/convert/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          mediaId,
          extractorPromptId: selectedExtractor,
          verifierPromptId: selectedVerifier,
        }),
        credentials: 'include',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || 'Queue failed')
      }

      const data = await response.json()
      setSuccess(`Conversion queued! Job ID: ${data.jobId}`)
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Queue failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        <h2>Convert PDF to Exercises</h2>
        <p style={filenameStyle}>File: {filename}</p>

        {error && <div style={errorBannerStyle}>{error}</div>}
        {success && <div style={successBannerStyle}>{success}</div>}

        {isLoading ? (
          <div style={{ color: 'var(--theme-elevation-500)' }}>Loading prompts...</div>
        ) : (
          <div>
            <div style={formFieldStyle}>
              <label htmlFor="extractor" style={labelStyle}>
                Extractor Prompt
              </label>
              <select
                id="extractor"
                value={selectedExtractor}
                onChange={(e) => setSelectedExtractor(e.target.value)}
                required
                style={selectStyle}
              >
                <option value="">Select extractor prompt...</option>
                {extractorPrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.title} ({prompt.key})
                  </option>
                ))}
              </select>
            </div>

            <div style={formFieldStyle}>
              <label htmlFor="verifier" style={labelStyle}>
                Verifier Prompt
              </label>
              <select
                id="verifier"
                value={selectedVerifier}
                onChange={(e) => setSelectedVerifier(e.target.value)}
                required
                style={selectStyle}
              >
                <option value="">Select verifier prompt...</option>
                {verifierPrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.title} ({prompt.key})
                  </option>
                ))}
              </select>
            </div>

            <div style={formActionsStyle}>
              <button
                type="button"
                style={{
                  ...buttonSecondaryStyle,
                  opacity: isSubmitting ? 0.5 : 1,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                }}
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...buttonPrimaryStyle,
                  opacity: isSubmitting || !selectedExtractor || !selectedVerifier ? 0.5 : 1,
                  cursor:
                    isSubmitting || !selectedExtractor || !selectedVerifier
                      ? 'not-allowed'
                      : 'pointer',
                }}
                onClick={handleSubmit}
                disabled={isSubmitting || !selectedExtractor || !selectedVerifier}
              >
                {isSubmitting ? 'Queuing...' : 'Queue Conversion'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
