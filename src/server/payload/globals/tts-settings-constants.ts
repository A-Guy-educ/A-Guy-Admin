/**
 * TtsSettings Shared Constants
 *
 * @fileType constants
 * @domain tts
 * @pattern shared-enum-source
 * @ai-summary Single source of truth for tts_settings voice/gender enums and defaults, shared across the global, seed, and public endpoint.
 *
 * Kept in one file because the same tuple was drifting across three edit
 * sites (global defaultValue, seed DEFAULTS, endpoint DEFAULTS). Bumping a
 * voice out of the enum now requires exactly one edit — and the endpoint's
 * runtime validation reads from the same lists, so stale DB values fall back
 * to defaults instead of being passed through to Google TTS.
 */

import type { TtsSetting } from '@/payload-types'

type HeVoice = TtsSetting['heVoice']
type EnVoice = TtsSetting['enVoice']
type Gender = TtsSetting['heGender']

export const HE_VOICE_OPTIONS: ReadonlyArray<{ label: string; value: HeVoice }> = [
  { label: 'he-IL-Wavenet-A (Female)', value: 'he-IL-Wavenet-A' },
  { label: 'he-IL-Wavenet-B (Male)', value: 'he-IL-Wavenet-B' },
  { label: 'he-IL-Wavenet-C (Female)', value: 'he-IL-Wavenet-C' },
  { label: 'he-IL-Wavenet-D (Male)', value: 'he-IL-Wavenet-D' },
  { label: 'he-IL-Standard-A (Female)', value: 'he-IL-Standard-A' },
  { label: 'he-IL-Standard-B (Male)', value: 'he-IL-Standard-B' },
  { label: 'he-IL-Standard-C (Female)', value: 'he-IL-Standard-C' },
  { label: 'he-IL-Standard-D (Male)', value: 'he-IL-Standard-D' },
]

export const EN_VOICE_OPTIONS: ReadonlyArray<{ label: string; value: EnVoice }> = [
  { label: 'en-US-Neural2-A (Male)', value: 'en-US-Neural2-A' },
  { label: 'en-US-Neural2-C (Female)', value: 'en-US-Neural2-C' },
  { label: 'en-US-Neural2-D (Male)', value: 'en-US-Neural2-D' },
  { label: 'en-US-Neural2-F (Female)', value: 'en-US-Neural2-F' },
  { label: 'en-US-Neural2-H (Female)', value: 'en-US-Neural2-H' },
  { label: 'en-US-Neural2-J (Male)', value: 'en-US-Neural2-J' },
  { label: 'en-US-Wavenet-D (Male)', value: 'en-US-Wavenet-D' },
  { label: 'en-US-Wavenet-F (Female)', value: 'en-US-Wavenet-F' },
]

export const GENDER_OPTIONS: ReadonlyArray<{ label: string; value: Gender }> = [
  { label: 'Female', value: 'FEMALE' },
  { label: 'Male', value: 'MALE' },
]

export const SPEAKING_RATE_MIN = 0.25
export const SPEAKING_RATE_MAX = 2.0
export const SPEAKING_RATE_STEP = 0.05

export type TtsSettingsDefaults = Pick<
  TtsSetting,
  'heVoice' | 'heGender' | 'enVoice' | 'enGender' | 'speakingRate'
>

export const TTS_DEFAULTS: TtsSettingsDefaults = {
  heVoice: 'he-IL-Wavenet-A',
  heGender: 'FEMALE',
  enVoice: 'en-US-Neural2-D',
  enGender: 'MALE',
  speakingRate: 0.85,
}

const HE_VOICE_VALUES: ReadonlySet<HeVoice> = new Set(HE_VOICE_OPTIONS.map((o) => o.value))
const EN_VOICE_VALUES: ReadonlySet<EnVoice> = new Set(EN_VOICE_OPTIONS.map((o) => o.value))
const GENDER_VALUES: ReadonlySet<Gender> = new Set(GENDER_OPTIONS.map((o) => o.value))

export function isValidHeVoice(v: unknown): v is HeVoice {
  return typeof v === 'string' && HE_VOICE_VALUES.has(v as HeVoice)
}

export function isValidEnVoice(v: unknown): v is EnVoice {
  return typeof v === 'string' && EN_VOICE_VALUES.has(v as EnVoice)
}

export function isValidGender(v: unknown): v is Gender {
  return typeof v === 'string' && GENDER_VALUES.has(v as Gender)
}

export function clampSpeakingRate(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return TTS_DEFAULTS.speakingRate
  return Math.min(SPEAKING_RATE_MAX, Math.max(SPEAKING_RATE_MIN, v))
}
