'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { stripMarkdown, detectLanguage } from '@/infra/utils/speechHelpers'
import type { SupportedLocale } from '@/infra/utils/latexToSpeech'

const LOCALE_TO_LANG: Record<string, string> = {
  he: 'he-IL',
  en: 'en-US',
}

function pickVoiceForLocale(locale: string): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined
  const voices = window.speechSynthesis.getVoices()
  const langPrefix = locale === 'he' ? ['he', 'iw'] : [locale]
  const matching = voices.filter((v) => langPrefix.some((p) => v.lang.includes(p)))
  if (matching.length === 0) return undefined
  if (locale === 'he') {
    return (
      matching.find((v) => v.name.includes('Natural') || v.name.includes('Online')) ??
      matching.find((v) => v.name.includes('Hila') || v.name.includes('Carmit')) ??
      matching.find((v) => v.name.includes('Google') || v.name.includes('Premium')) ??
      matching[0]
    )
  }
  return (
    matching.find((v) => v.name.includes('Natural') || v.name.includes('Google')) ?? matching[0]
  )
}

interface UseTTSReturn {
  speak: (messageId: string, text: string, locale?: SupportedLocale) => void
  stop: () => void
  pause: () => void
  resume: () => void
  setRate: (rate: number) => void
  playingMessageId: string | null
  isPaused: boolean
  currentRate: number
}

export function useTTS(): UseTTSReturn {
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [currentRate, setCurrentRateState] = useState(1.0)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    utteranceRef.current = null
    setPlayingMessageId(null)
    setIsPaused(false)
  }, [])

  const pause = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause()
      setIsPaused(true)
    }
  }, [])

  const resume = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
      setIsPaused(false)
    }
  }, [])

  const setRate = useCallback((rate: number) => {
    setCurrentRateState(rate)
    if (utteranceRef.current) {
      utteranceRef.current.rate = rate
    }
  }, [])

  const speak = useCallback(
    (messageId: string, text: string, locale?: SupportedLocale) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return
      if (playingMessageId === messageId && !isPaused) {
        stop()
        return
      }
      if (playingMessageId === messageId && isPaused) {
        resume()
        return
      }
      stop()
      // Detect language if not provided
      const detectedLocale: SupportedLocale =
        locale ?? (detectLanguage(text) === 'he-IL' ? 'he' : 'en')
      const cleanText = stripMarkdown(text, detectedLocale)
      if (!cleanText) return
      const utterance = new SpeechSynthesisUtterance(cleanText)
      utterance.lang = LOCALE_TO_LANG[detectedLocale] ?? 'en-US'
      const voice = pickVoiceForLocale(detectedLocale)
      if (voice) utterance.voice = voice
      // Rate 0.85 and pitch 0.95 for teacher-cadence tuning
      utterance.rate = 0.85 * currentRate
      utterance.pitch = 0.95
      utterance.onend = () => {
        setPlayingMessageId(null)
        utteranceRef.current = null
        setIsPaused(false)
      }
      utterance.onerror = () => {
        setPlayingMessageId(null)
        utteranceRef.current = null
        setIsPaused(false)
      }
      utteranceRef.current = utterance
      setPlayingMessageId(messageId)
      window.speechSynthesis.speak(utterance)
    },
    [playingMessageId, stop, isPaused, resume, currentRate],
  )

  useEffect(
    () => () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    },
    [],
  )

  return { speak, stop, pause, resume, setRate, playingMessageId, isPaused, currentRate }
}
