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
 *
 * Voice/gender enums, defaults, and validation live in
 * `./tts-settings-constants.ts` — the endpoint imports the same lists so a
 * DB value trimmed from the enum falls back to the current default rather
 * than being passed through to Google TTS.
 */

import type { GlobalConfig } from 'payload'

import { configAdminOnly } from '../access/configAdminOnly'
import {
  EN_VOICE_OPTIONS,
  GENDER_OPTIONS,
  HE_VOICE_OPTIONS,
  SPEAKING_RATE_MAX,
  SPEAKING_RATE_MIN,
  SPEAKING_RATE_STEP,
  TTS_DEFAULTS,
} from './tts-settings-constants'

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
      defaultValue: TTS_DEFAULTS.heVoice,
      options: [...HE_VOICE_OPTIONS],
      admin: {
        description: 'Google Cloud voice name for Hebrew TTS.',
      },
    },
    {
      name: 'heGender',
      type: 'select',
      required: true,
      defaultValue: TTS_DEFAULTS.heGender,
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
      defaultValue: TTS_DEFAULTS.enVoice,
      options: [...EN_VOICE_OPTIONS],
      admin: {
        description: 'Google Cloud voice name for English TTS.',
      },
    },
    {
      name: 'enGender',
      type: 'select',
      required: true,
      defaultValue: TTS_DEFAULTS.enGender,
      options: [...GENDER_OPTIONS],
      admin: {
        description: 'ssmlGender passed to Google TTS alongside enVoice.',
      },
    },
    {
      name: 'speakingRate',
      type: 'number',
      required: true,
      defaultValue: TTS_DEFAULTS.speakingRate,
      min: SPEAKING_RATE_MIN,
      max: SPEAKING_RATE_MAX,
      admin: {
        step: SPEAKING_RATE_STEP,
        description:
          'Google TTS speakingRate. 1.0 is natural speed; 0.85 is our current default. Endpoint clamps to [0.25, 2.0] so a corrupt DB value never reaches Google TTS.',
      },
    },
  ],
}
