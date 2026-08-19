/**
 * Resolves which authenticated principal is making a PATCH request to
 * /api/users/me/course-state and which user id to write to.
 *
 * Two supported auth paths:
 *   - Cookie session: `req.user` is populated by Payload's auth resolver.
 *     Self-write only — target user is always `req.user.id`. Rejects any
 *     `userId` in the body to close a privilege-escalation surface where an
 *     admin-panel session accidentally forwards a body from an untrusted
 *     source.
 *   - Service token: `x-service-token` header, compared to
 *     `ADMIN_SERVICE_TOKEN` with `crypto.timingSafeEqual`. The Web app uses
 *     this from a same-origin server proxy so browser clients never see the
 *     Admin cookie. Requires `userId` in the body — that is the target user.
 *
 * Presenting both paths in the same request (cookie + header) is ambiguous
 * and rejected 400. Neither is 401.
 *
 * When `ADMIN_SERVICE_TOKEN` is unset, service-token calls collapse to the
 * "invalid token" branch (401) instead of surfacing a distinct 500. This
 * avoids leaking the fact that the service path exists but is misconfigured.
 */
import crypto from 'crypto'

import type { PayloadRequest } from 'payload'

export type AuthResolution =
  | { ok: true; mode: 'cookie' | 'service'; targetUserId: string }
  | { ok: false; status: number; error: string }

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) {
    // Still burn a comparison against a same-length buffer to keep timing
    // roughly constant regardless of which side is longer.
    crypto.timingSafeEqual(aBuf, Buffer.alloc(aBuf.length))
    return false
  }
  return crypto.timingSafeEqual(aBuf, bBuf)
}

export function resolveCourseStateAuth(
  req: PayloadRequest,
  bodyUserId: string | undefined,
): AuthResolution {
  const serviceToken = req.headers instanceof Headers ? req.headers.get('x-service-token') : null
  const hasCookieAuth = Boolean(req.user)

  if (serviceToken && hasCookieAuth) {
    return {
      ok: false,
      status: 400,
      error: 'Cannot present both cookie auth and service-token header',
    }
  }

  if (!serviceToken && !hasCookieAuth) {
    return { ok: false, status: 401, error: 'Authentication required' }
  }

  if (serviceToken) {
    const expected = process.env.ADMIN_SERVICE_TOKEN
    if (!expected || !timingSafeStringEqual(serviceToken, expected)) {
      return { ok: false, status: 401, error: 'Invalid service token' }
    }
    if (!bodyUserId) {
      return { ok: false, status: 400, error: 'userId required when using service token' }
    }
    return { ok: true, mode: 'service', targetUserId: bodyUserId }
  }

  // Cookie auth path: self-write only. Reject body userId defensively so an
  // admin-panel session cannot be tricked into targeting another user.
  if (bodyUserId) {
    return {
      ok: false,
      status: 400,
      error: 'userId not allowed with cookie auth — cookie sessions are self-write only',
    }
  }
  return { ok: true, mode: 'cookie', targetUserId: req.user!.id }
}
