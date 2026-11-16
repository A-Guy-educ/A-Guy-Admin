import { describe, expect, it } from 'vitest'

import {
  pointLabelPlacement,
  svgPointLabelAttrs,
} from '@/infra/utils/graphics/point-label-placement'

describe('pointLabelPlacement', () => {
  it('centres top/bottom labels horizontally on the dot', () => {
    expect(pointLabelPlacement('b')).toEqual({
      offset: [0, -11],
      anchorX: 'middle',
      anchorY: 'top',
    })
    expect(pointLabelPlacement('t')).toEqual({
      offset: [0, 11],
      anchorX: 'middle',
      anchorY: 'bottom',
    })
  })

  it('anchors the side facing the dot for left/right labels', () => {
    expect(pointLabelPlacement('l')).toEqual({
      offset: [-11, 0],
      anchorX: 'right',
      anchorY: 'middle',
    })
    expect(pointLabelPlacement('r')).toEqual({
      offset: [11, 0],
      anchorX: 'left',
      anchorY: 'middle',
    })
  })

  it('anchors the facing corner for diagonals at the same ring distance', () => {
    expect(pointLabelPlacement('tl')).toEqual({
      offset: [-8, 8],
      anchorX: 'right',
      anchorY: 'bottom',
    })
    expect(pointLabelPlacement('br')).toEqual({ offset: [8, -8], anchorX: 'left', anchorY: 'top' })
  })

  it('centres middle labels on the dot', () => {
    const centred = { offset: [0, 0], anchorX: 'middle', anchorY: 'middle' }
    expect(pointLabelPlacement('m')).toEqual(centred)
    expect(pointLabelPlacement('middle')).toEqual(centred)
  })

  it('uses the fallback for missing or unknown positions', () => {
    expect(pointLabelPlacement(undefined)).toEqual(pointLabelPlacement('r'))
    expect(pointLabelPlacement('nope')).toEqual(pointLabelPlacement('r'))
    expect(pointLabelPlacement(undefined, { fallback: 'tr' })).toEqual(pointLabelPlacement('tr'))
  })

  it('scales with a custom gap', () => {
    expect(pointLabelPlacement('b', { gapPx: 14 }).offset).toEqual([0, -14])
    expect(pointLabelPlacement('tr', { gapPx: 14 }).offset).toEqual([10, 10])
  })
})

describe('svgPointLabelAttrs', () => {
  it('flips y and maps anchors to SVG text attributes', () => {
    expect(svgPointLabelAttrs(pointLabelPlacement('t'))).toEqual({
      dx: 0,
      dy: -11,
      textAnchor: 'middle',
      dominantBaseline: 'auto',
    })
    expect(svgPointLabelAttrs(pointLabelPlacement('bl'))).toEqual({
      dx: -8,
      dy: 8,
      textAnchor: 'end',
      dominantBaseline: 'hanging',
    })
  })
})
