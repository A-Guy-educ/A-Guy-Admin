/**
 * TtsSettings Global Seed
 *
 * @fileType migration
 * @domain tts
 * @pattern global-defaults-upsert
 * @ai-summary Ensures the tts_settings global exists in Mongo on first boot so A-Guy-Web's public fetch never sees a missing document.
 *
 * Payload synthesises defaults on `findGlobal` even before a DB row exists,
 * so this is belt-and-braces: it materialises the row so admins immediately
 * see an editable value.
 *
 * Concurrency: the "check then updateGlobal" pair is NOT atomic across
 * replicas. If two cold serverless instances boot against an empty DB at the
 * same time, both may pass the `existing?.updatedAt` check and both may
 * write. That is safe today ONLY because both writes carry the identical
 * `TTS_DEFAULTS` payload — the second write is a no-op overwrite of the
 * first. If this seed ever grows to write per-tenant or per-env values,
 * swap the check for a Mongo `updateOne(..., { upsert: true, $setOnInsert:
 * DEFAULTS })` to make it atomic. Keeping the simpler form now because
 * moving to raw Mongo means bypassing Payload hooks/validation.
 *
 * Errors are logged-and-swallowed (rather than rethrown like
 * `runSeedFeaturesOnInit`) because the public endpoint inlines the same
 * defaults — a failed seed still returns correct data to Web. Features seed
 * has no such fallback, hence its stricter policy.
 */

import type { Payload } from 'payload'

import { TTS_DEFAULTS } from '@/server/payload/globals/tts-settings-constants'

async function seedTtsSettings(payload: Payload): Promise<void> {
  const existing = await payload.findGlobal({
    slug: 'tts_settings',
    depth: 0,
    overrideAccess: true,
  })

  if (existing?.updatedAt) return

  await payload.updateGlobal({
    slug: 'tts_settings',
    data: TTS_DEFAULTS,
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
