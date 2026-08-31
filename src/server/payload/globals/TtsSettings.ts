/**
 * TtsSettings Global
 *
 * @fileType global-config
 * @domain tts
 * @pattern runtime-config
 * @ai-summary Runtime-editable voice + speaking rate for the chat-lesson TTS pipeline.
 *
 * Consumed by A-Guy-Web via GET /api/tts-settings/current (60s CDN cache).
 * Non-secret; public read via the dedicated endpoint (see
 * endpoints/tts-settings/current.ts). Direct /api/globals/tts_settings reads
 * stay admin-only via `configAdminOnly`.
 */

import type { GlobalConfig } from 'payload'

import { configAdminOnly } from '../access/configAdminOnly'

const HE_VOICE_OPTIONS = [
  { label: 'he-IL-Wavenet-A (Female)', value: 'he-IL-Wavenet-A' },
  { label: 'he-IL-Wavenet-B (Male)', value: 'he-IL-Wavenet-B' },
  { label: 'he-IL-Wavenet-C (Female)', value: 'he-IL-Wavenet-C' },
  { label: 'he-IL-Wavenet-D (Male)', value: 'he-IL-Wavenet-D' },
  { label: 'he-IL-Standard-A (Female)', value: 'he-IL-Standard-A' },
  { label: 'he-IL-Standard-B (Male)', value: 'he-IL-Standard-B' },
  { label: 'he-IL-Standard-C (Female)', value: 'he-IL-Standard-C' },
  { label: 'he-IL-Standard-D (Male)', value: 'he-IL-Standard-D' },
] as const

const EN_VOICE_OPTIONS = [
  { label: 'en-US-Neural2-A (Male)', value: 'en-US-Neural2-A' },
  { label: 'en-US-Neural2-C (Female)', value: 'en-US-Neural2-C' },
  { label: 'en-US-Neural2-D (Male)', value: 'en-US-Neural2-D' },
  { label: 'en-US-Neural2-F (Female)', value: 'en-US-Neural2-F' },
  { label: 'en-US-Neural2-H (Female)', value: 'en-US-Neural2-H' },
  { label: 'en-US-Neural2-J (Male)', value: 'en-US-Neural2-J' },
  { label: 'en-US-Wavenet-D (Male)', value: 'en-US-Wavenet-D' },
  { label: 'en-US-Wavenet-F (Female)', value: 'en-US-Wavenet-F' },
] as const

const GENDER_OPTIONS = [
  { label: 'Female', value: 'FEMALE' },
  { label: 'Male', value: 'MALE' },
] as const

export const TtsSettings: GlobalConfig = {
  slug: 'tts_settings',
  admin: {
    group: 'System',
    description:
      'Google Cloud TTS voice + speaking rate for chat-lesson audio. Consumed by A-Guy-Web via /api/tts-settings/current (60s CDN cache — changes propagate within ~1 min).',
  },
  access: {
    read: configAdminOnly,
    update: configAdminOnly,
  },
  fields: [
    {
      name: 'heVoice',
      type: 'select',
      required: true,
      defaultValue: 'he-IL-Wavenet-A',
      options: [...HE_VOICE_OPTIONS],
      admin: {
        description: 'Google Cloud voice name for Hebrew TTS.',
      },
    },
    {
      name: 'heGender',
      type: 'select',
      required: true,
      defaultValue: 'FEMALE',
      options: [...GENDER_OPTIONS],
      admin: {
        description:
          'ssmlGender passed to Google TTS alongside heVoice. Kept as its own field so gender can be overridden per voice.',
      },
    },
    {
      name: 'enVoice',
      type: 'select',
      required: true,
      defaultValue: 'en-US-Neural2-D',
      options: [...EN_VOICE_OPTIONS],
      admin: {
        description: 'Google Cloud voice name for English TTS.',
      },
    },
    {
      name: 'enGender',
      type: 'select',
      required: true,
      defaultValue: 'MALE',
      options: [...GENDER_OPTIONS],
      admin: {
        description: 'ssmlGender passed to Google TTS alongside enVoice.',
      },
    },
    {
      name: 'speakingRate',
      type: 'number',
      required: true,
      defaultValue: 0.85,
      min: 0.25,
      max: 2.0,
      admin: {
        step: 0.05,
        description: 'Google TTS speakingRate. 1.0 is natural speed; 0.85 is our current default.',
      },
    },
  ],
}
