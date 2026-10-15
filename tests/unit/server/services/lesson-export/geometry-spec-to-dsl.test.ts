import { describe, expect, it } from 'vitest'

import { geometrySpecToDsl } from '@/server/services/lesson-export/geometry-spec-to-dsl'
import { parseGeometryDsl } from '@/server/services/text-lesson-import/parse-geometry-dsl'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'

function baseSpec(overrides: Partial<GeometrySpecV1['elements']> = {}): GeometrySpecV1 {
  return {
    kind: 'euclidean',
    canvas: { width: 400, height: 400 },
    elements: {
      points: [],
      lines: [],
      circles: [],
      angles: [],
      ...overrides,
    },
  }
}

describe('geometrySpecToDsl', () => {
  it('emits a --- נקודות --- section for points with labels + positions', () => {
    const spec = baseSpec({
      points: [
        { name: 'A', x: 200, y: 60, position: 'tl' },
        { name: 'B', x: 80, y: 240, position: 'bl' },
      ],
    })

    const dsl = geometrySpecToDsl(spec)
    expect(dsl).toContain('--- נקודות ---')
    expect(dsl).toContain('* נקודה A | מיקום: X=200, Y=60 | מיקום תווית: שמאל-למעלה')
    expect(dsl).toContain('* נקודה B | מיקום: X=80, Y=240 | מיקום תווית: שמאל-למטה')
  })

  it('emits segments with mnemonic from/to and dashed marker', () => {
    const spec = baseSpec({
      points: [
        { name: 'A', x: 0, y: 0 },
        { name: 'B', x: 10, y: 10 },
      ],
      lines: [
        { from: 'A', to: 'B', style: 'solid' },
        { from: 'A', to: 'B', style: 'dashed', color: 'blue', thickness: 2 },
      ],
    })
    const dsl = geometrySpecToDsl(spec)
    expect(dsl).toContain('* קטע AB | מנקודה A לנקודה B')
    expect(dsl).toContain('מקווקו: כן')
    expect(dsl).toContain('צבע: כחול')
    expect(dsl).toContain('עובי: 2')
  })

  it('emits angles with name = ray1+center+ray2 and square-marker syntax', () => {
    const spec = baseSpec({
      angles: [
        { center: 'B', ray1: 'A', ray2: 'C', style: 'square' },
        { center: 'O', ray1: 'A', ray2: 'C', color: 'red', arcRadius: 30 },
      ],
    })
    const dsl = geometrySpecToDsl(spec)
    expect(dsl).toContain('* זווית ABC | קודקוד: B | סימון: ריבוע 90°')
    expect(dsl).toContain('* זווית AOC | קודקוד: O | נמדדת בין: OA ל- OC | צבע: אדום | רדיוס: 30')
  })

  it('round-trips a triangle (ABC) with segments through parseGeometryDsl', () => {
    const spec = baseSpec({
      points: [
        { name: 'A', x: 200, y: 60 },
        { name: 'B', x: 80, y: 240 },
        { name: 'C', x: 320, y: 240 },
      ],
      lines: [
        { from: 'A', to: 'B', style: 'solid' },
        { from: 'A', to: 'C', style: 'solid' },
        { from: 'B', to: 'C', style: 'solid' },
      ],
    })

    const dsl = geometrySpecToDsl(spec)
    const parsed = parseGeometryDsl(dsl)

    expect(parsed.warnings).toEqual([])
    expect(parsed.hasContent).toBe(true)
    expect(parsed.spec.elements.points.map((p) => p.name)).toEqual(['A', 'B', 'C'])
    expect(parsed.spec.elements.points[0]).toMatchObject({ x: 200, y: 60 })
    expect(parsed.spec.elements.lines).toHaveLength(3)
    expect(parsed.spec.elements.lines[0]).toMatchObject({
      from: 'A',
      to: 'B',
      style: 'solid',
    })
  })

  it('returns empty string when the spec has no renderable content', () => {
    expect(geometrySpecToDsl(baseSpec())).toBe('')
  })

  it('maps common English colors to Hebrew', () => {
    const spec = baseSpec({
      points: [
        { name: 'A', x: 0, y: 0, color: 'red' },
        { name: 'B', x: 0, y: 0, color: 'blue' },
        { name: 'C', x: 0, y: 0, color: 'green' },
      ],
    })
    const dsl = geometrySpecToDsl(spec)
    expect(dsl).toContain('צבע: אדום')
    expect(dsl).toContain('צבע: כחול')
    expect(dsl).toContain('צבע: ירוק')
  })

  it('emits circle rows with center + through fields', () => {
    const spec = baseSpec({
      circles: [
        { center: 'O', through: 'A', style: 'solid' },
        { center: 'O', radius: 50, style: 'dashed', color: 'blue' },
      ],
    })
    const dsl = geometrySpecToDsl(spec)
    expect(dsl).toContain('* מעגל 1 | מרכז: O | עובר דרך: A')
    expect(dsl).toContain('* מעגל 2 | מרכז: O | רדיוס גרפי: 50 | צבע: כחול | מקווקו: כן')
  })

  it('marks points as hidden when visible is false', () => {
    const spec = baseSpec({
      points: [{ name: 'H', x: 10, y: 20, visible: false }],
    })
    const dsl = geometrySpecToDsl(spec)
    expect(dsl).toContain('מוצגת: לא')
  })
})
