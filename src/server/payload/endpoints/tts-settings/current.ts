/**
 * GET /api/tts-settings/current
 *
 * @fileType api-route
 * @domain tts
 * @pattern public-config-projection
 * @ai-summary Public read-only projection of the tts_settings global for A-Guy-Web to consume without a deploy per voice change.
 *
 * No auth required — voice + speakingRate are non-secret runtime config.
 * Response is cached at the CDN for 60s (with 5m SWR), so voice changes
 * propagate within ~1 minute without hammering the DB. Web is expected to
 * pair this with its own ~60s in-process cache; the 5m SWR window is the
 * safety net if a fetch fails while Web's TTL has already expired.
 *
 * Access-Control-Allow-Origin: * — response is non-secret, public by design.
 * Payload's config `cors` array only lists the admin origin; setting the
 * header inline here lets Web (or any other sibling app) hit this from the
 * browser without another cross-repo config change.
 *
 * Every returned value is re-validated against the current enum lists (see
 * tts-settings-constants.ts). If a voice was trimmed from the enum after
 * being saved to the DB, the stale value falls back to the default rather
 * than being handed to Google TTS as an unknown voice — that silent failure
 * mode is exactly why this global was created in the first place.
 */

import type { PayloadRequest } from 'payload'

import {
  clampSpeakingRate,
  isValidEnVoice,
  isValidGender,
  isValidHeVoice,
  TTS_DEFAULTS,
  type TtsSettingsDefaults,
} from '@/server/payload/globals/tts-settings-constants'

export async function ttsSettingsCurrentEndpoint(req: PayloadRequest): Promise<Response> {
  const global = await req.payload.findGlobal({
    slug: 'tts_settings',
    depth: 0,
    overrideAccess: true,
  })

  const body: TtsSettingsDefaults = {
    heVoice: isValidHeVoice(global?.heVoice) ? global.heVoice : TTS_DEFAULTS.heVoice,
    heGender: isValidGender(global?.heGender) ? global.heGender : TTS_DEFAULTS.heGender,
    enVoice: isValidEnVoice(global?.enVoice) ? global.enVoice : TTS_DEFAULTS.enVoice,
    enGender: isValidGender(global?.enGender) ? global.enGender : TTS_DEFAULTS.enGender,
    speakingRate: clampSpeakingRate(global?.speakingRate),
  }

  return Response.json(body, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
