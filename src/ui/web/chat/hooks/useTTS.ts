'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { stripMarkdown, detectLanguage } from '@/infra/utils/speechHelpers'
import type { SupportedLocale } from '@/infra/utils/latexToSpeech'

const LOCALE_TO_LANG: Record<string, string> = {
  he: 'he-IL',
  en: 'en-US',
}

/** Prime the voice list so getVoices() is populated when we need it. */
function primeSpeechVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.getVoices()
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices()
    }
  }
}

function pickVoiceForLocale(locale: string): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined
  const voices = window.speechSynthesis.getVoices()
  console.warn('[TTS] Available voices:', voices.map((v) => `${v.name} (${v.lang})`).join(', '))
  const langPrefix = locale === 'he' ? ['he', 'iw'] : [locale]
  const matching = voices.filter((v) => langPrefix.some((p) => v.lang.startsWith(p)))

  if (matching.length > 0) {
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

  // No voice for this locale — fall back to any English voice so speech isn't silent
  if (locale === 'he') {
    const enVoices = voices.filter((v) => v.lang.includes('en'))
    if (enVoices.length > 0) {
      console.warn('[TTS] No Hebrew voice found, falling back to English voice')
      return (
        enVoices.find((v) => v.name.includes('Natural') || v.name.includes('Google')) ?? enVoices[0]
      )
    }
  }

  // Last resort — return first available voice
  return voices[0]
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

  // Prime voice list on mount (Chrome loads voices async)
  useEffect(() => {
    primeSpeechVoices()
  }, [])

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    utteranceRef.current = null
    setPlayingMessageId(null)
    setIsPaused(false)
  }, [])

  const pause = useCallback(() => {
    if (
      typeof window !== 'undefined' &&
      window.speechSynthesis &&
      window.speechSynthesis.speaking
    ) {
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
      // Cancel only if there's something playing — avoids Chrome cancel/speak race
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel()
      }
      utteranceRef.current = null
      setIsPaused(false)

      // Detect language if not provided
      const detectedLocale: SupportedLocale =
        locale ?? (detectLanguage(text) === 'he-IL' ? 'he' : 'en')
      const cleanText = stripMarkdown(text, detectedLocale)
      if (!cleanText) {
        console.warn('[TTS] cleanText is empty, nothing to speak')
        return
      }

      const utterance = new SpeechSynthesisUtterance(cleanText)
      utterance.lang = LOCALE_TO_LANG[detectedLocale] ?? 'en-US'
      const voice = pickVoiceForLocale(detectedLocale)
      if (voice) utterance.voice = voice
      utterance.rate = 0.85 * currentRate
      utterance.pitch = 0.95
      console.warn(
        '[TTS] Speaking:',
        cleanText.slice(0, 80),
        '| lang:',
        utterance.lang,
        '| voice:',
        voice?.name ?? 'default',
        '| rate:',
        utterance.rate,
      )
      utterance.onend = () => {
        setPlayingMessageId(null)
        utteranceRef.current = null
        setIsPaused(false)
      }
      utterance.onerror = (e) => {
        console.warn('[TTS] Speech error:', e.error, 'text length:', cleanText.length)
        setPlayingMessageId(null)
        utteranceRef.current = null
        setIsPaused(false)
      }
      utteranceRef.current = utterance
      setPlayingMessageId(messageId)

      // Speak synchronously — must stay in user gesture call stack or Chrome blocks audio
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
