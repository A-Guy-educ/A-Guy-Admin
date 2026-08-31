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
 */

import type { PayloadRequest } from 'payload'

import type { TtsSetting } from '@/payload-types'

type TtsSettingsProjection = Pick<
  TtsSetting,
  'heVoice' | 'heGender' | 'enVoice' | 'enGender' | 'speakingRate'
>

const DEFAULTS: TtsSettingsProjection = {
  heVoice: 'he-IL-Wavenet-A',
  heGender: 'FEMALE',
  enVoice: 'en-US-Neural2-D',
  enGender: 'MALE',
  speakingRate: 0.85,
}

export async function ttsSettingsCurrentEndpoint(req: PayloadRequest): Promise<Response> {
  const global = await req.payload.findGlobal({
    slug: 'tts_settings',
    depth: 0,
    overrideAccess: true,
  })

  const body: TtsSettingsProjection = {
    heVoice: global?.heVoice ?? DEFAULTS.heVoice,
    heGender: global?.heGender ?? DEFAULTS.heGender,
    enVoice: global?.enVoice ?? DEFAULTS.enVoice,
    enGender: global?.enGender ?? DEFAULTS.enGender,
    speakingRate:
      typeof global?.speakingRate === 'number' ? global.speakingRate : DEFAULTS.speakingRate,
  }

  return Response.json(body, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  })
}
