import { describe, expect, it } from 'vitest'

import { AxisSpecV1Schema } from '@/infra/contracts/graphics/axis.v1'
import { parseFunctionDsl } from '@/server/services/lesson-json-import/parse-function-dsl'

// Canonical reference sample from functions_import_schema.md — kept inline so
// the test doubles as executable documentation of the format the curriculum
// team writes.
const REFERENCE_SAMPLE = [
  '%%%',
  '$f(x) = (x-4)^2 + 3$',
  'color: #3366cc',
  'style: solid',
  'width: 2',
  '',
  '$g(x) = x$',
  'color: #de1e64',
  'style: dashed',
  'width: 2',
  '',
  '$x=5$',
  'color: #89e1ab',
  'style: dotted',
  'width: 2',
  '',
  'p (1,1)',
  'color: #ccccff',
  'type: point',
  'label: נסיון',
  '',
  'l (0,0,) (1,1)',
  'style: dashed',
  '%%%',
  'x:[-1,9]',
  'y:[0,20]',
  '',
  'grid: true',
  '%%%',
].join('\n')

describe('parseFunctionDsl', () => {
  it('parses the reference sample into a valid AxisSpecV1', () => {
    const { spec, errors } = parseFunctionDsl(REFERENCE_SAMPLE)

    expect(errors).toEqual([])
    // The whole point of always returning `spec` is that it survives
    // AxisSpecV1Schema — if this ever fails, the converter would emit a
    // block Payload rejects, so guard it here.
    expect(() => AxisSpecV1Schema.parse(spec)).not.toThrow()

    expect(spec.grid.enabled).toBe(true)
    expect(spec.viewportMode).toBe('manual')
    // Stated x:[-1,9] → span 10, padded 15% each side → [-2.5, 10.5].
    // Stated y:[0,20] → span 20, padded 15% each side → [-3, 23].
    expect(spec.viewport).toEqual({ xMin: -2.5, xMax: 10.5, yMin: -3, yMax: 23 })

    // Two `f(x)=` graphs make it to `graphs`; `$x=5$` is not a function
    // of x so it becomes a geometric locus with its color/style preserved.
    expect(spec.elements.graphs).toEqual([
      expect.objectContaining({ fn: '(x-4)^2 + 3', style: 'solid', color: '#3366cc' }),
      expect.objectContaining({ fn: 'x', style: 'dashed', color: '#de1e64' }),
    ])
    expect(spec.elements.geometricLoci).toEqual([
      expect.objectContaining({ equation: 'x=5', style: 'dotted', color: '#89e1ab' }),
    ])

    expect(spec.elements.points).toEqual([
      expect.objectContaining({ x: 1, y: 1, color: '#ccccff', label: 'נסיון', type: 'point' }),
    ])

    // The `(0,0,)` trailing-comma typo from the reference sample must not
    // knock the line out — parse tolerantly.
    expect(spec.elements.lineBetweenPoints).toEqual([
      expect.objectContaining({
        a: { x: 0, y: 0 },
        b: { x: 1, y: 1 },
        style: 'dashed',
      }),
    ])
  })

  it('reports errors for unrecognized element headers but still returns a valid spec', () => {
    const source = ['%%%', 'q (bogus)', 'style: solid', '%%%', 'grid: true', '%%%'].join('\n')

    const { spec, errors } = parseFunctionDsl(source)

    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatch(/unrecognized/i)
    expect(() => AxisSpecV1Schema.parse(spec)).not.toThrow()
    // Broken element is skipped, not silently coerced into something else.
    expect(spec.elements.graphs).toEqual([])
    expect(spec.elements.geometricLoci ?? []).toEqual([])
  })

  it('flags an empty input rather than returning an unusable spec', () => {
    const { errors } = parseFunctionDsl('')
    expect(errors).toEqual(['Function block is empty'])
  })

  it('accepts a single section without any %%% separators (settings-only)', () => {
    // Just to prove the parser doesn't require the closing markers when the
    // author only supplies elements — the curriculum team occasionally
    // trims trailing markers.
    const source = ['$f(x) = 2*x', 'style: solid'].join('\n')
    const { spec, errors } = parseFunctionDsl(source)

    // No `$..$` wrapper — the first line isn't a valid header, so it goes
    // to the error list. We still get a spec back.
    expect(errors.length).toBeGreaterThan(0)
    expect(spec.elements.graphs).toEqual([])
  })

  it('rejects malformed range values with a descriptive error', () => {
    const source = ['%%%', '$f(x) = x$', '%%%', 'x:hello', '%%%'].join('\n')
    const { errors } = parseFunctionDsl(source)
    expect(errors.some((e) => e.includes('Invalid range for x'))).toBe(true)
  })

  it('parses fraction literals like 5/6 inside point and line coordinates', () => {
    // Regression: authors write `p (2/3, 0)` to match the fraction notation
    // they use elsewhere in the lesson. Number("2/3") is NaN, so the old
    // parser silently dropped the point.
    const source = [
      '%%%',
      'p (2/3, 0)',
      'color: #de1e64',
      'type: point',
      '',
      'l (0,0) (5, 5/6)',
      'color: #333333',
      '%%%',
      'x:[0,6]',
      'y:[0,1]',
      '%%%',
    ].join('\n')

    const { spec, errors } = parseFunctionDsl(source)
    expect(errors).toEqual([])
    expect(spec.elements.points).toEqual([
      expect.objectContaining({ x: 2 / 3, y: 0, color: '#de1e64' }),
    ])
    expect(spec.elements.lineBetweenPoints).toEqual([
      expect.objectContaining({ a: { x: 0, y: 0 }, b: { x: 5, y: 5 / 6 } }),
    ])
  })

  it('pads the viewport 15% on each side so boundary points remain visible', () => {
    const source = ['%%%', 'p (0,0)', '%%%', 'x:[0,1]', 'y:[0,1]', '%%%'].join('\n')
    const { spec } = parseFunctionDsl(source)
    // Boundary point at (0,0) would sit exactly on the axis without padding.
    expect(spec.viewport).toEqual({ xMin: -0.15, xMax: 1.15, yMin: -0.15, yMax: 1.15 })
  })
})
