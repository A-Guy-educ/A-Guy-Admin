import { describe, expect, it } from 'vitest'
import { orderRaysForMinorAngle } from '@/infra/utils/graphics/angle-label'

const pt = (x: number, y: number) => ({ X: () => x, Y: () => y })

describe('orderRaysForMinorAngle', () => {
  it('keeps ray order when the CCW sweep from ray1 to ray2 is ≤ 180°', () => {
    const center = pt(0, 0)
    const ray1 = pt(1, 0) // 0°
    const ray2 = pt(0, 1) // 90° CCW — smaller angle already
    const [a, b] = orderRaysForMinorAngle(center, ray1, ray2)
    expect(a).toBe(ray1)
    expect(b).toBe(ray2)
  })

  it('swaps rays when the CCW sweep exceeds 180° (would render the reflex)', () => {
    const center = pt(0, 0)
    const ray1 = pt(0, 1) // 90°
    const ray2 = pt(1, 0) // 0° — CCW sweep from ray1 to ray2 is 270°
    const [a, b] = orderRaysForMinorAngle(center, ray1, ray2)
    expect(a).toBe(ray2)
    expect(b).toBe(ray1)
  })

  it('handles vertices offset from origin', () => {
    const center = pt(5, 5)
    const ray1 = pt(5, 6) // straight up from center
    const ray2 = pt(6, 5) // straight right from center — 270° CCW, swap expected
    const [a, b] = orderRaysForMinorAngle(center, ray1, ray2)
    expect(a).toBe(ray2)
    expect(b).toBe(ray1)
  })

  it('keeps order for anti-parallel rays (180°, cross product is zero)', () => {
    const center = pt(0, 0)
    const ray1 = pt(1, 0)
    const ray2 = pt(-1, 0)
    const [a, b] = orderRaysForMinorAngle(center, ray1, ray2)
    expect(a).toBe(ray1)
    expect(b).toBe(ray2)
  })
})
