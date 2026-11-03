import { describe, expect, it } from 'vitest'
import {
  clampLabelSize,
  MAX_LABEL_SIZE,
  MIN_LABEL_SIZE,
} from '@/ui/admin/ExerciseContentEditor/components/shared/LabelSizeInput'

describe('clampLabelSize', () => {
  it('keeps in-range values', () => {
    expect(clampLabelSize(20, 15)).toBe(20)
  })

  it('clamps below min and above max', () => {
    expect(clampLabelSize(2, 15)).toBe(MIN_LABEL_SIZE)
    expect(clampLabelSize(99, 15)).toBe(MAX_LABEL_SIZE)
  })

  it('falls back when the input is not a number', () => {
    expect(clampLabelSize(NaN, 15)).toBe(15)
  })
})
