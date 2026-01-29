import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readIntEnv } from '@/server/config/constants'

describe('readIntEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('missing or empty env variable', () => {
    it('returns default when env not set', () => {
      delete process.env.TEST_INT
      expect(readIntEnv('TEST_INT', 10)).toBe(10)
    })

    it('returns default when env is empty string', () => {
      process.env.TEST_INT = ''
      expect(readIntEnv('TEST_INT', 10)).toBe(10)
    })
  })

  describe('invalid values', () => {
    it('throws when value is not an integer', () => {
      process.env.TEST_INT = 'not-a-number'
      expect(() => readIntEnv('TEST_INT', 10)).toThrow('Invalid TEST_INT')
    })

    it('throws when value is below minimum', () => {
      process.env.TEST_INT = '5'
      expect(() => readIntEnv('TEST_INT', 10, { min: 10 })).toThrow('below minimum')
    })

    it('throws when value exceeds maximum', () => {
      process.env.TEST_INT = '100'
      expect(() => readIntEnv('TEST_INT', 50, { max: 75 })).toThrow('exceeds maximum')
    })
  })

  describe('valid values', () => {
    it('parses positive integer', () => {
      process.env.TEST_INT = '42'
      expect(readIntEnv('TEST_INT', 10)).toBe(42)
    })

    it('parses zero', () => {
      process.env.TEST_INT = '0'
      expect(readIntEnv('TEST_INT', 10)).toBe(0)
    })
  })
})
