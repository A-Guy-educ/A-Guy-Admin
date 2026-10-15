/**
 * Unit tests for the Tranzila V2 HMAC auth header builder.
 *
 * These are not integration tests — they do not hit Tranzila. They
 * verify that:
 *   - The HMAC computation is deterministic given fixed inputs
 *   - The returned header shape matches what we document
 *   - Field layout (nowSeconds, nonce width) is as advertised
 *
 * Ground-truth verification against the real API lives in
 * `scripts/smoke-tranzila-v2-auth.ts` (requires real creds).
 */

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { buildV2AuthHeaders } from '@/lib/payment/tranzila-v2-client'

describe('buildV2AuthHeaders', () => {
  const PUB = 'test-public-key-abcdef'
  const PRIV = 'test-private-key'
  // Fixed clock: 2026-10-15T13:00:00Z → 1792063200
  const FIXED_TIME = 1792063200
  const FIXED_NONCE = 'a'.repeat(40)

  it('returns the four documented header fields', () => {
    const headers = buildV2AuthHeaders({
      publicKey: PUB,
      privateKey: PRIV,
      nowSeconds: FIXED_TIME,
      nonce: FIXED_NONCE,
    })
    expect(Object.keys(headers).sort()).toEqual([
      'X-tranzila-api-access-token',
      'X-tranzila-api-app-key',
      'X-tranzila-api-nonce',
      'X-tranzila-api-request-time',
    ])
  })

  it('is deterministic for identical inputs', () => {
    const a = buildV2AuthHeaders({
      publicKey: PUB,
      privateKey: PRIV,
      nowSeconds: FIXED_TIME,
      nonce: FIXED_NONCE,
    })
    const b = buildV2AuthHeaders({
      publicKey: PUB,
      privateKey: PRIV,
      nowSeconds: FIXED_TIME,
      nonce: FIXED_NONCE,
    })
    expect(a).toEqual(b)
  })

  it('computes HMAC-SHA256(key=privateKey+time+nonce, msg=publicKey) in hex', () => {
    const headers = buildV2AuthHeaders({
      publicKey: PUB,
      privateKey: PRIV,
      nowSeconds: FIXED_TIME,
      nonce: FIXED_NONCE,
    })
    // Recompute independently; if the implementation ever drifts from the
    // documented layout (e.g. msg/key get swapped by accident), this
    // regression check catches it.
    const expected = createHmac('sha256', `${PRIV}${FIXED_TIME}${FIXED_NONCE}`)
      .update(PUB)
      .digest('hex')
    expect(headers['X-tranzila-api-access-token']).toBe(expected)
  })

  it('surfaces the public key verbatim in the app-key header', () => {
    const headers = buildV2AuthHeaders({
      publicKey: PUB,
      privateKey: PRIV,
      nowSeconds: FIXED_TIME,
      nonce: FIXED_NONCE,
    })
    expect(headers['X-tranzila-api-app-key']).toBe(PUB)
  })

  it('emits request-time as Unix SECONDS (not ms) as a string', () => {
    const headers = buildV2AuthHeaders({
      publicKey: PUB,
      privateKey: PRIV,
      nowSeconds: FIXED_TIME,
      nonce: FIXED_NONCE,
    })
    expect(headers['X-tranzila-api-request-time']).toBe(String(FIXED_TIME))
    // Sanity: a correct value is a 10-digit number (through 2286-11-20).
    // Catches an accidental Date.now() (13-digit ms).
    expect(headers['X-tranzila-api-request-time']).toMatch(/^\d{10}$/)
  })

  it('generates a 40-hex-char nonce by default', () => {
    const headers = buildV2AuthHeaders({ publicKey: PUB, privateKey: PRIV })
    expect(headers['X-tranzila-api-nonce']).toMatch(/^[0-9a-f]{40}$/)
  })

  it('produces different nonces on consecutive calls (not seeded)', () => {
    const a = buildV2AuthHeaders({ publicKey: PUB, privateKey: PRIV })
    const b = buildV2AuthHeaders({ publicKey: PUB, privateKey: PRIV })
    expect(a['X-tranzila-api-nonce']).not.toBe(b['X-tranzila-api-nonce'])
  })

  it('throws when publicKey is empty', () => {
    expect(() => buildV2AuthHeaders({ publicKey: '', privateKey: PRIV })).toThrow(/publicKey/)
  })

  it('throws when privateKey is empty', () => {
    expect(() => buildV2AuthHeaders({ publicKey: PUB, privateKey: '' })).toThrow(/privateKey/)
  })
})
