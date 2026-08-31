/**
 * TtsSettings Global Seed
 *
 * @fileType migration
 * @domain tts
 * @pattern global-defaults-upsert
 * @ai-summary Ensures the tts_settings global exists in Mongo on first boot so A-Guy-Web's public fetch never sees a missing document.
 *
 * Payload synthesises defaults on `findGlobal` even before a DB row exists, so
 * this is belt-and-braces: it materialises the row so admins immediately see
 * an editable value, and matches the seed pattern used elsewhere (see
 * features-seed.ts). Idempotent — skips when the doc already has an
 * updatedAt (meaning something has written it before, seed OR admin edit).
 */

import type { Payload } from 'payload'

import type { TtsSetting } from '@/payload-types'

type TtsSettingsDefaults = Pick<
  TtsSetting,
  'heVoice' | 'heGender' | 'enVoice' | 'enGender' | 'speakingRate'
>

const DEFAULTS: TtsSettingsDefaults = {
  heVoice: 'he-IL-Wavenet-A',
  heGender: 'FEMALE',
  enVoice: 'en-US-Neural2-D',
  enGender: 'MALE',
  speakingRate: 0.85,
}

async function seedTtsSettings(payload: Payload): Promise<void> {
  const existing = await payload.findGlobal({
    slug: 'tts_settings',
    depth: 0,
    overrideAccess: true,
  })

  if (existing?.updatedAt) return

  await payload.updateGlobal({
    slug: 'tts_settings',
    data: DEFAULTS,
    depth: 0,
    overrideAccess: true,
  })
  payload.logger.info('[TtsSettingsSeed] Created default tts_settings global')
}

export async function runSeedTtsSettingsOnInit(payload: Payload): Promise<void> {
  try {
    await seedTtsSettings(payload)
  } catch (err) {
    payload.logger.error({ err }, '[TtsSettingsSeed] Failed to seed tts_settings')
  }
}
