import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  adminContentSecurityPolicy,
  contentSecurityPolicy,
} from '@/infra/security/content-security-policy.js'
import { middleware } from '@/middleware'

describe('middleware CSP', () => {
  function createRequest(pathname = '/admin') {
    const url = new URL(pathname, 'https://kp-admin-pr-1.fly.dev')
    const headers = new Headers()
    headers.set('host', url.host)

    return new NextRequest(url, { headers })
  }

  it('sets the shared CSP on normal pages', () => {
    const response = middleware(createRequest('/'))

    expect(response.headers.get('Content-Security-Policy')).toBe(contentSecurityPolicy)
  })

  it('sets the admin CSP on admin pages', () => {
    const response = middleware(createRequest('/admin'))

    expect(response.headers.get('Content-Security-Policy')).toBe(adminContentSecurityPolicy)
  })

  it('does not restrict which preview hosts can embed pages', () => {
    expect(contentSecurityPolicy).not.toContain('frame-ancestors')
    expect(adminContentSecurityPolicy).not.toContain('frame-ancestors')
    expect(contentSecurityPolicy).not.toContain('kody-dashboard-aguy.vercel.app')
    expect(adminContentSecurityPolicy).not.toContain('kody-dashboard-aguy.vercel.app')
  })

  it('keeps the PDF viewer free to use its own response headers', () => {
    const response = middleware(createRequest('/api/pdfjs-viewer'))

    expect(response.headers.get('Content-Security-Policy')).toBeNull()
  })
})
