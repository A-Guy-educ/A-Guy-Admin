import { describe, expect, it } from 'vitest'

import { AxisSpecV1Schema } from '@/infra/contracts/graphics/axis.v1'
import { GeometrySpecV1Schema } from '@/infra/contracts/graphics/geometry.v1'

const axis = {
  kind: 'cartesian',
  units: 1,
  grid: { enabled: true },
  axes: {
    showNumbers: true,
    showLabels: true,
    ticks: 1,
    labels: { x: 'x', y: 'y' },
    origin: { x: 0, y: 0 },
  },
  viewportMode: 'auto',
  elements: { points: [], graphs: [] },
}

const geometry = {
  kind: 'euclidean',
  canvas: { width: 400, height: 400 },
  elements: { points: [], lines: [], circles: [], angles: [] },
}

describe('graphics spec `interactive` flag', () => {
  it.each([
    ['axis', AxisSpecV1Schema, axis],
    ['geometry', GeometrySpecV1Schema, geometry],
  ] as const)('%s spec accepts interactive on/off and omitted', (_, schema, base) => {
    expect(schema.safeParse(base).success).toBe(true)
    expect(schema.safeParse({ ...base, interactive: false }).success).toBe(true)
    expect(schema.safeParse({ ...base, interactive: true }).success).toBe(true)
    expect(schema.safeParse({ ...base, interactive: 'no' }).success).toBe(false)
  })
})
