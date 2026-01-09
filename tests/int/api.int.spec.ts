import { getPayload, Payload } from 'payload'
import config from '@payload-config'

import { describe, it, beforeAll, expect } from 'vitest'

let payload: Payload

describe('API', () => {
  beforeAll(
    async () => {
      try {
        payload = await getPayload({ config })
      } catch (error) {
        console.error('Failed to initialize Payload:', error)
        throw error
      }
    },
    30000, // 30 second timeout for Payload initialization
  )

  it('fetches users', async () => {
    const users = await payload.find({
      collection: 'users',
    })
    expect(users).toBeDefined()
    expect(users.docs).toBeDefined()
    expect(Array.isArray(users.docs)).toBe(true)
  })
})
