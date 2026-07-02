import { describe, expect, it } from 'vitest'

import { withPartitionedPayloadAuthCookie } from '@/infra/auth/payload_auth_cookie_headers'

describe('Payload auth cookie headers', () => {
  it('marks the Payload token cookie as partitioned for cross-site admin iframes', async () => {
    const response = withPartitionedPayloadAuthCookie(
      new Response('ok', {
        headers: {
          'Set-Cookie':
            'payload-token=abc123; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/; Secure=true; HttpOnly=true; SameSite=None',
        },
      }),
    )

    expect(response.headers.get('Set-Cookie')).toContain('SameSite=None')
    expect(response.headers.get('Set-Cookie')).toContain('Partitioned')
  })

  it('preserves unrelated cookies when rewriting combined Set-Cookie headers', () => {
    const response = withPartitionedPayloadAuthCookie(
      new Response('ok', {
        headers: {
          'Set-Cookie':
            'payload-token=abc123; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/; Secure=true; HttpOnly=true; SameSite=None, NEXT_LOCALE=he; Path=/; SameSite=Lax',
        },
      }),
    )

    const setCookie = response.headers.get('Set-Cookie')

    expect(setCookie).toContain('payload-token=abc123')
    expect(setCookie).toContain('Partitioned')
    expect(setCookie).toContain('NEXT_LOCALE=he; Path=/; SameSite=Lax')
  })

  it('does not add Partitioned to non-Payload cookies', () => {
    const response = withPartitionedPayloadAuthCookie(
      new Response('ok', {
        headers: {
          'Set-Cookie': 'NEXT_LOCALE=he; Path=/; SameSite=None; Secure',
        },
      }),
    )

    expect(response.headers.get('Set-Cookie')).toBe('NEXT_LOCALE=he; Path=/; SameSite=None; Secure')
  })
})
