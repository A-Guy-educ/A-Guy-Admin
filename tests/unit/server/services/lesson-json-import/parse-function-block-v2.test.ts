import { describe, expect, it } from 'vitest'

import {
  isFunctionBlockV2,
  parseFunctionBlockV2,
} from '@/server/services/lesson-json-import/parse-function-block-v2'
import { parseFunctionDsl } from '@/server/services/lesson-json-import/parse-function-dsl'

describe('isFunctionBlockV2', () => {
  it('recognises the standalone `[ גרף בסיס ]` header', () => {
    const raw = ['================', '[ גרף בסיס ]', '================'].join('\n')
    expect(isFunctionBlockV2(raw)).toBe(true)
  })

  it('recognises the embedded CONFIGURATION-only form', () => {
    const raw = ['some Hebrew intro', '', 'CONFIGURATION:', '  Units: 1'].join('\n')
    expect(isFunctionBlockV2(raw)).toBe(true)
  })

  it('rejects the legacy %%% DSL', () => {
    const raw = ['%%%', '$f(x) = x^2$', '%%%', 'x:[-1,9]', 'y:[0,20]', '%%%'].join('\n')
    expect(isFunctionBlockV2(raw)).toBe(false)
  })
})

const STANDALONE_FIXTURE = [
  '================================================================================',
  '[ גרף בסיס ]',
  '================================================================================',
  '',
  'CONFIGURATION:',
  'Units: 1',
  'XY Proportion: 1',
  'Ticks: 1',
  'Grid: true',
  'Numbers: true',
  'Labels: true',
  'X Label: x',
  'Y Label: y',
  'Manual Range: true',
  'X Min: -6',
  'X Max: 6',
  'Y Min: -6',
  'Y Max: 23',
  '',
  '---',
  '',
  '## GRAPHS',
  '',
  'Graph 1:',
  'Function F(X): (1/3)\\*(x+2)^2-3',
  'Style: Solid',
  'Width: 2',
  'Color: Red',
  '',
  'Graph 2:',
  'Function F(X): x^2-6\\*x+5',
  'Style: Solid',
  'Width: 2',
  'Color: Red',
  '',
  '---',
  '',
  '## POINTS',
  '',
  'A:',
  'X: -2',
  'Y: 21',
  'Type: Point',
  'Label: A',
  'Size: 4',
  'Color: Black',
  '',
  'B:',
  'X: -2',
  'Y: -3',
  'Type: Point',
  'Label: B',
  'Size: 4',
  'Color: Black',
  '',
  'C:',
  'X: 3',
  'Y: -4',
  'Type: Point',
  'Label: C',
  'Size: 4',
  'Color: Black',
  '',
  'D:',
  'X: 3',
  'Y: 16/3',
  'Type: Point',
  'Label: D',
  'Size: 4',
  'Color: Black',
  '',
  '---',
  '',
  '## LINES BETWEEN POINTS',
  '',
  'AB:',
  'Points: A > B',
  'Style: Dashed',
  'Width: 2',
  'Color: Black',
  'Arrow: false',
  '',
  'CD:',
  'Points: C > D',
  'Style: Dashed',
  'Width: 2',
  'Color: Black',
  'Arrow: false',
  '',
  '---',
  '',
  '## ASYMPTOTES',
  '',
  'None',
  '',
  '---',
  '',
  '## PAINT BETWEEN GRAPHS',
  '',
  'None',
  '',
  '================================================================================',
].join('\n')

describe('parseFunctionBlockV2 — standalone `[ גרף בסיס ]` shape', () => {
  it('parses configuration, graphs, points, and lines into AxisSpecV1', () => {
    const { spec, warnings } = parseFunctionBlockV2(STANDALONE_FIXTURE)
    expect(warnings).toEqual([])
    expect(spec.units).toBe(1)
    expect(spec.proportion).toBe(1)
    expect(spec.grid).toEqual({ enabled: true })
    expect(spec.axes).toMatchObject({
      ticks: 1,
      showNumbers: true,
      showLabels: true,
      labels: { x: 'x', y: 'y' },
    })
    expect(spec.viewportMode).toBe('manual')
    expect(spec.viewport).toEqual({ xMin: -6, xMax: 6, yMin: -6, yMax: 23 })

    expect(spec.elements.graphs).toEqual([
      { id: 'Graph 1', fn: '(1/3)*(x+2)^2-3', style: 'solid', thickness: 2, color: 'red' },
      { id: 'Graph 2', fn: 'x^2-6*x+5', style: 'solid', thickness: 2, color: 'red' },
    ])
    // Backslash-escaped `*` was stripped, `16/3` fraction was evaluated.
    expect(spec.elements.points).toHaveLength(4)
    expect(spec.elements.points[3]).toMatchObject({ x: 3, y: 16 / 3, label: 'D' })

    // AB / CD resolve to their point coordinates.
    expect(spec.elements.lineBetweenPoints).toEqual([
      {
        style: 'dashed',
        thickness: 2,
        a: { x: -2, y: 21 },
        b: { x: -2, y: -3 },
        color: 'black',
        arrow: false,
      },
      {
        style: 'dashed',
        thickness: 2,
        a: { x: 3, y: -4 },
        b: { x: 3, y: 16 / 3 },
        color: 'black',
        arrow: false,
      },
    ])
  })
})

describe('parseFunctionBlockV2 — embedded/indented shape', () => {
  it('accepts bare `GRAPHS` / `POINTS` section headers between `---` fences', () => {
    const raw = [
      'CONFIGURATION:',
      '  Units: 1',
      '  Grid: true',
      '  Manual Range: true',
      '  X Min: -5',
      '  X Max: 5',
      '  Y Min: -2',
      '  Y Max: 10',
      '',
      '--------------------------------------------------------------------------------',
      'GRAPHS',
      '--------------------------------------------------------------------------------',
      '',
      'Graph 1:',
      '  Function F(X): x^2',
      '  Style: Solid',
      '  Width: 2',
      '  Color: Blue',
      '',
      'Graph 2:',
      '  Function F(X): -x^2+8',
      '  Style: Solid',
      '  Width: 2',
      '  Color: Red',
      '',
      '--------------------------------------------------------------------------------',
      'POINTS',
      '--------------------------------------------------------------------------------',
      '',
      'A:',
      '  X: -2',
      '  Y: 4',
      '  Type: Point',
      '  Label: A',
      '',
    ].join('\n')

    const { spec, warnings } = parseFunctionBlockV2(raw)
    expect(warnings).toEqual([])
    expect(spec.elements.graphs).toHaveLength(2)
    expect(spec.elements.graphs[0]).toMatchObject({ fn: 'x^2', color: 'blue' })
    expect(spec.elements.graphs[1]).toMatchObject({ fn: '-x^2+8', color: 'red' })
    expect(spec.elements.points).toHaveLength(1)
    expect(spec.elements.points[0]).toMatchObject({ x: -2, y: 4, label: 'A' })
    expect(spec.viewport).toEqual({ xMin: -5, xMax: 5, yMin: -2, yMax: 10 })
  })
})

describe('parseFunctionDsl auto-detection', () => {
  it('routes the boss format through parseFunctionBlockV2', () => {
    const { spec, errors } = parseFunctionDsl(STANDALONE_FIXTURE)
    expect(errors).toEqual([])
    expect(spec.elements.graphs).toHaveLength(2)
  })

  it('still parses the legacy `%%%` DSL when the boss signature is absent', () => {
    const raw = ['$f(x) = x^2$', 'color: #3366cc', 'style: solid', 'width: 2'].join('\n')
    const { spec, errors } = parseFunctionDsl(raw)
    expect(errors).toEqual([])
    expect(spec.elements.graphs).toHaveLength(1)
    expect(spec.elements.graphs[0]).toMatchObject({ fn: 'x^2', color: '#3366cc' })
  })
})
