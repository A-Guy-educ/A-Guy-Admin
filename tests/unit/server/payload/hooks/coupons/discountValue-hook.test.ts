import { describe, expect, it } from 'vitest'

import {
  afterReadDiscountValue,
  computeDiscountDisplay,
} from '@/server/payload/hooks/coupons/discountValue-hook'

/**
 * Fixed coupons store agorot; the afterRead hook converts back to shekels for
 * the admin form. The admin form posts that value straight back and the
 * beforeChange hook re-multiplies by 100, so any precision lost here is
 * written to the database on the next save.
 */
type HookArgs = Parameters<typeof afterReadDiscountValue>[0]

const read = (value: unknown, discountType: string) =>
  afterReadDiscountValue({ siblingData: { discountType }, value } as unknown as HookArgs)

describe('afterReadDiscountValue', () => {
  it('converts whole-shekel fixed coupons back to shekels', async () => {
    await expect(read(3000, 'fixed')).resolves.toBe(30)
  })

  it('preserves agorot on fractional fixed coupons', async () => {
    await expect(read(3050, 'fixed')).resolves.toBe(30.5)
    await expect(read(999, 'fixed')).resolves.toBe(9.99)
  })

  it('round-trips without drift: read → re-save → read', async () => {
    const stored = 3050
    const shown = (await read(stored, 'fixed')) as number
    // beforeChange re-multiplies whatever the form posts back
    const reStored = Math.round(shown * 100)
    expect(reStored).toBe(stored)
  })

  it('leaves percentage coupons untouched', async () => {
    await expect(read(30, 'percentage')).resolves.toBe(30)
  })

  it('passes through non-numeric values', async () => {
    await expect(read(undefined, 'fixed')).resolves.toBeUndefined()
    await expect(read(null, 'fixed')).resolves.toBeNull()
  })
})

describe('computeDiscountDisplay', () => {
  it('formats fixed coupons from agorot', () => {
    expect(computeDiscountDisplay('fixed', 3000)).toBe('₪30.00')
    expect(computeDiscountDisplay('fixed', 3050)).toBe('₪30.50')
  })

  it('formats percentage coupons', () => {
    expect(computeDiscountDisplay('percentage', 30)).toBe('30%')
  })

  it('returns empty string for unknown types or missing values', () => {
    expect(computeDiscountDisplay('fixed', undefined)).toBe('')
    expect(computeDiscountDisplay(undefined, 3000)).toBe('')
  })
})
