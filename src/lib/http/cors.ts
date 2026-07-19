/**
 * CORS helpers for custom Next.js App Router routes.
 *
 * Payload's built-in `cors` config (`src/payload.config.ts`) only covers
 * Payload's REST/GraphQL endpoints — it does NOT cover custom routes like
 * `/api/course-selections`. Use these helpers from those routes instead.
 *
 * Design rules (enforced by every function in this file):
 *  - Echo the exact request `Origin` if it matches the allowlist. Never return
 *    `Access-Control-Allow-Origin: *` — the browser rejects wildcards when
 *    `Access-Control-Allow-Credentials: true` is also set.
 *  - Always set `Vary: Origin` on responses that carry
 *    `Access-Control-Allow-Origin` so CDN/edge caches don't serve one origin's
 *    CORS response to another.
 *  - If the request `Origin` is missing or not allowlisted, omit CORS headers
 *    entirely — the browser will block the call with a CORS error, which is the
 *    desired behaviour for non-allowlisted origins.
 */

const ALLOWED_ORIGINS: readonly string[] = [
  'https://a-guy-web.vercel.app', // prod (Vercel canonical)
  'https://www.aguy.co.il', // prod alias
  'https://aguy.co.il', // prod alias (apex)
  'https://a-guy-dev-aguy.vercel.app', // dev preview
  'http://localhost:3000', // local dev
]

// Vercel preview URLs for the Web repo, e.g. https://a-guy-pr123-aguy.vercel.app
const VERCEL_PREVIEW_REGEX = /^https:\/\/a-guy-[a-z0-9-]+-aguy\.vercel\.app$/

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.includes(origin)) return true
  return VERCEL_PREVIEW_REGEX.test(origin)
}

/**
 * Returns CORS headers for the given request origin. When the origin is not
 * allowlisted, returns an empty object so callers can spread it safely into a
 * response's headers map without leaking CORS state to non-allowlisted origins.
 */
export function buildCorsHeaders(origin: string | null | undefined): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/**
 * Wraps a Response with CORS headers appropriate to the request's Origin.
 * Headers from the original response are preserved and the CORS headers (when
 * the origin is allowlisted) are layered on top. Status code and body are
 * untouched.
 */
export function applyCorsHeaders(response: Response, request: Request): Response {
  const origin = request.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin)

  // When there are no CORS headers to add (non-allowlisted or missing origin)
  // we still need to preserve the original response unchanged.
  if (Object.keys(corsHeaders).length === 0) return response

  const newHeaders = new Headers(response.headers)
  for (const [name, value] of Object.entries(corsHeaders)) {
    newHeaders.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}

/**
 * Build the response for a CORS preflight (OPTIONS) request.
 *
 * The browser issues OPTIONS before any cross-origin request that uses
 * non-simple headers/methods. The response must be `204` (or `200`) with only
 * the CORS headers — no auth, no body parsing, no rate limit.
 */
export function createPreflightResponse(request: Request): Response {
  const origin = request.headers.get('origin')
  const corsHeaders = buildCorsHeaders(origin)

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  })
}
