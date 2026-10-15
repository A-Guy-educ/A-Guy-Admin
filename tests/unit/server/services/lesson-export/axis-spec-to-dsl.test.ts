import { describe, expect, it } from 'vitest'

import { axisSpecToDsl } from '@/server/services/lesson-export/axis-spec-to-dsl'
import { parseFunctionDsl } from '@/server/services/lesson-json-import/parse-function-dsl'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'

function baseSpec(overrides: Partial<AxisSpecV1> = {}): AxisSpecV1 {
  return {
    kind: 'cartesian',
    units: 1,
    grid: { enabled: false },
    axes: {
      showNumbers: true,
      showLabels: false,
      ticks: 1,
      labels: { x: 'x', y: 'y' },
      origin: { x: 0, y: 0 },
    },
    viewportMode: 'manual',
    viewport: { xMin: -1, xMax: 6, yMin: -5, yMax: 4 },
    elements: { points: [], graphs: [] },
    ...overrides,
  }
}

describe('axisSpecToDsl', () => {
  it('emits a <function>-wrapped %%% fenced DSL block for a graph + point + viewport', () => {
    const spec = baseSpec({
      elements: {
        graphs: [{ id: 'g1', fn: 'x-3', color: 'blue', style: 'solid', thickness: 2 }],
        points: [{ x: 3, y: 0, type: 'point', color: 'black', label: 'Point 1' }],
      },
    })

    const dsl = axisSpecToDsl(spec)

    expect(dsl.startsWith('<function>')).toBe(true)
    expect(dsl.endsWith('</function>')).toBe(true)
    expect(dsl).toContain('%%%')
    expect(dsl).toContain('$f(x) = x-3$')
    expect(dsl).toContain('color: blue')
    expect(dsl).toContain('style: solid')
    expect(dsl).toContain('width: 2')
    expect(dsl).toContain('p (3,0)')
    expect(dsl).toContain('label: Point 1')
    expect(dsl).toContain('x:[-1,6]')
    expect(dsl).toContain('y:[-5,4]')
    expect(dsl).toContain('grid: false')
  })

  it('returns empty string when the spec has no elements to render', () => {
    const spec = baseSpec({ elements: { graphs: [], points: [] } })
    expect(axisSpecToDsl(spec)).toBe('')
  })

  it('round-trips a graph + point through parseFunctionDsl', () => {
    const spec = baseSpec({
      elements: {
        graphs: [{ id: 'g1', fn: '2*x+3', color: 'red', style: 'solid', thickness: 2 }],
        points: [{ x: 1, y: 5, type: 'point' }],
      },
    })

    const dsl = axisSpecToDsl(spec)
    const inner = dsl.replace(/^<function>\s*/, '').replace(/\s*<\/function>$/, '')
    const parsed = parseFunctionDsl(inner)

    expect(parsed.errors).toEqual([])
    expect(parsed.spec.elements.graphs).toHaveLength(1)
    expect(parsed.spec.elements.graphs[0]).toMatchObject({
      fn: '2*x+3',
      color: 'red',
    })
    expect(parsed.spec.elements.points).toHaveLength(1)
    expect(parsed.spec.elements.points[0]).toMatchObject({ x: 1, y: 5 })
  })

  it('emits lineBetweenPoints as "l (x1,y1) (x2,y2)" blocks', () => {
    const spec = baseSpec({
      elements: {
        graphs: [],
        points: [],
        lineBetweenPoints: [
          {
            a: { x: 0, y: 0 },
            b: { x: 2, y: 4 },
            style: 'dashed',
            thickness: 2,
            color: 'green',
          },
        ],
      },
    })

    const dsl = axisSpecToDsl(spec)
    expect(dsl).toContain('l (0,0) (2,4)')
    expect(dsl).toContain('style: dashed')
    expect(dsl).toContain('color: green')
  })

  it('omits viewport section when viewportMode is auto', () => {
    const spec = baseSpec({
      viewportMode: 'auto',
      viewport: undefined,
      elements: { graphs: [{ id: 'g1', fn: 'x', style: 'solid', thickness: 2 }], points: [] },
    })

    const dsl = axisSpecToDsl(spec)
    expect(dsl).not.toContain('x:[')
    expect(dsl).not.toContain('y:[')
    // Still emits grid settings
    expect(dsl).toContain('grid: false')
  })

  it('emits labels: true only when showLabels is set', () => {
    const specWith = baseSpec({
      axes: {
        showNumbers: true,
        showLabels: true,
        ticks: 1,
        labels: { x: 'x', y: 'y' },
        origin: { x: 0, y: 0 },
      },
      elements: { graphs: [{ id: 'g1', fn: 'x', style: 'solid', thickness: 2 }], points: [] },
    })
    expect(axisSpecToDsl(specWith)).toContain('labels: true')

    const specWithout = baseSpec({
      elements: { graphs: [{ id: 'g1', fn: 'x', style: 'solid', thickness: 2 }], points: [] },
    })
    expect(axisSpecToDsl(specWithout)).not.toContain('labels: true')
  })

  it('emits geometric loci (vertical lines, implicit curves) as $equation$ blocks', () => {
    const spec = baseSpec({
      elements: {
        graphs: [],
        points: [],
        geometricLoci: [{ equation: 'x=5', style: 'dotted', thickness: 2, color: 'green' }],
      },
    })

    const dsl = axisSpecToDsl(spec)
    expect(dsl).toContain('$x=5$')
    expect(dsl).toContain('style: dotted')
    expect(dsl).toContain('color: green')
  })
})
