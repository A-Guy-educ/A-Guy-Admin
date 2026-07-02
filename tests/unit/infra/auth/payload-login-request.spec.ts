import { describe, expect, it } from 'vitest'

import { normalizePayloadLoginRequest } from '@/infra/auth/payload_login_request'

describe('Payload login request normalization', () => {
  it('converts browser form login submissions into the JSON body Payload expects', async () => {
    const request = new Request('https://admin.example.com/api/users/login', {
      body: new URLSearchParams({
        email: 'admin@example.com',
        password: 'secret-password',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      method: 'POST',
    })

    const normalized = await normalizePayloadLoginRequest(request)

    expect(normalized).not.toBe(request)
    expect(normalized.headers.get('content-type')).toBe('application/json')
    await expect(normalized.json()).resolves.toEqual({
      email: 'admin@example.com',
      password: 'secret-password',
    })
  })

  it('leaves JSON login requests unchanged', async () => {
    const request = new Request('https://admin.example.com/api/users/login', {
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'secret-password',
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    await expect(normalizePayloadLoginRequest(request)).resolves.toBe(request)
  })

  it('leaves non-login form submissions unchanged', async () => {
    const request = new Request('https://admin.example.com/api/users', {
      body: new URLSearchParams({
        email: 'admin@example.com',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    })

    await expect(normalizePayloadLoginRequest(request)).resolves.toBe(request)
  })
})
