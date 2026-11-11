import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  adminContentSecurityPolicy,
  contentSecurityPolicy,
} from '@/infra/security/content-security-policy.js'
import { middleware } from '@/middleware'

describe('CSP configuration', () => {
  function extractDirective(csp: string, directive: string): string | null {
    const match = csp.match(new RegExp(`${directive}\\s+([^;]+)`))
    return match ? match[1] : null
  }

  function createRequest(pathname: string) {
    const url = new URL(pathname, 'https://kp-admin-pr-1.fly.dev')
    const headers = new Headers()
    headers.set('host', url.host)

    return new NextRequest(url, { headers })
  }

  it('allows Vercel feedback assets in script-src', () => {
    const scriptSrc = extractDirective(adminContentSecurityPolicy, 'script-src')

    expect(scriptSrc).not.toBeNull()
    expect(scriptSrc).toContain('https://vercel.live')
  })

  it('allows Vercel feedback connections in connect-src', () => {
    const connectSrc = extractDirective(adminContentSecurityPolicy, 'connect-src')

    expect(connectSrc).not.toBeNull()
    expect(connectSrc).toContain('https://vercel.live')
  })

  it('allows Gravatar avatars in admin img-src', () => {
    const imgSrc = extractDirective(adminContentSecurityPolicy, 'img-src')

    expect(imgSrc).not.toBeNull()
    expect(imgSrc).toContain('*.gravatar.com')
  })

  it('does not restrict which hosts can embed admin preview pages', () => {
    expect(contentSecurityPolicy).not.toContain('frame-ancestors')
    expect(adminContentSecurityPolicy).not.toContain('frame-ancestors')
  })

  it('sets admin CSP from middleware on admin routes', () => {
    const response = middleware(createRequest('/admin'))

    expect(response.headers.get('Content-Security-Policy')).toBe(adminContentSecurityPolicy)
    expect(response.headers.get('x-locale')).toBeNull()
  })
})
