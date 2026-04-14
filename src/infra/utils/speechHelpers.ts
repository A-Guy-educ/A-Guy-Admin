/**
 * @fileType utility
 * @domain shared
 * @pattern text-processing
 * @ai-summary Shared helpers for speech synthesis: markdown stripping and language detection
 */

import { latexToSpeech, type SupportedLocale } from './latexToSpeech'

/**
 * Convert LaTeX math expressions within text to spoken equivalents,
 * then strip remaining markdown formatting.
 *
 * Handles both inline ($...$) and block ($$...$$) math, converting them
 * to natural spoken text using latexToSpeech before removing other markup.
 */
export function stripMarkdown(text: string, locale: SupportedLocale = 'en'): string {
  // First, convert block math $$...$$ to spoken text
  let result = text.replace(/\$\$([^$]+)\$\$/g, (_, latex) => {
    const spoken = latexToSpeech(latex.trim(), locale)
    return spoken ? ` ${spoken} ` : ''
  })

  // Convert inline math $...$ to spoken text
  result = result.replace(/\$([^$]+)\$/g, (_, latex) => {
    const spoken = latexToSpeech(latex.trim(), locale)
    return spoken ? ` ${spoken} ` : ''
  })

  // Strip remaining markdown formatting
  return result
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\\[a-zA-Z]+(\{[^}]*\})*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*{1,2}|_{1,2})(.*?)\1/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/^---+$/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Detect if text is primarily Hebrew based on character frequency. */
export function detectLanguage(text: string): 'he-IL' | 'en-US' {
  const hebrewChars = (text.match(/[\u0590-\u05FF]/g) || []).length
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length
  return hebrewChars > latinChars ? 'he-IL' : 'en-US'
}
