import { describe, expect, it } from 'vitest'

import { parseGeometryDsl } from '@/server/services/text-lesson-import/parse-geometry-dsl'

describe('parseGeometryDsl', () => {
  it('parses points with Hebrew label positions and visibility flags', () => {
    const raw = [
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=50, Y=50 | מיקום תווית: שמאל-למעלה | מוצגת: כן',
      '  * נקודה O | מיקום: X=200, Y=200 | מיקום תווית: מימין | מוצגת: כן',
      '  * נקודה H | מיקום: X=200, Y=350 | מיקום תווית: למטה | מוצגת: לא',
    ].join('\n')

    const { spec, hasContent, warnings } = parseGeometryDsl(raw)

    expect(hasContent).toBe(true)
    expect(warnings).toEqual([])
    expect(spec.kind).toBe('euclidean')
    expect(spec.elements.points).toEqual([
      { name: 'A', x: 50, y: 50, position: 'tl' },
      { name: 'O', x: 200, y: 200, position: 'r' },
      { name: 'H', x: 200, y: 350, position: 'b', visible: false },
    ])
  })

  it('parses compressed "A (100,100), B (300,100)" point lists', () => {
    const raw = ['  --- נקודות ---', '  * A (100,100), B (300,100), C (300,220), D (100,220)'].join(
      '\n',
    )

    const { spec, hasContent } = parseGeometryDsl(raw)

    expect(hasContent).toBe(true)
    expect(spec.elements.points).toHaveLength(4)
    expect(spec.elements.points.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D'])
    expect(spec.elements.points[0]).toMatchObject({ x: 100, y: 100 })
  })

  it('parses segments with color, thickness, dashed style, and length label', () => {
    const raw = [
      '  --- ישרים וקטעים ---',
      '  * קטע AB | מנקודה A לנקודה B | צבע: כחול | עובי: 2',
      '  * קטע AC | מנקודה A לנקודה C | צבע: אדום | מקווקו: כן | ערך: 8 ס"מ',
    ].join('\n')

    const { spec } = parseGeometryDsl(raw)

    expect(spec.elements.lines).toEqual([
      { from: 'A', to: 'B', style: 'solid', color: 'blue', thickness: 2 },
      {
        from: 'A',
        to: 'C',
        style: 'dashed',
        color: 'red',
        label: { value: '8 ס"מ', position: 'm' },
      },
    ])
  })

  it('parses angles with color, radius, and label value', () => {
    const raw = [
      '  --- זוויות לתצוגה ---',
      '  * זווית AOC | קודקוד: O | נמדדת בין: OA ל- OC | צבע: אדום | רדיוס: 30',
      '  * זווית ABC | קודקוד: B | סימון: ריבוע 90°',
      '  * זווית PTQ | קודקוד: T | נמדדת בין: TP ל- TQ | ערך: 100°',
    ].join('\n')

    const { spec } = parseGeometryDsl(raw)

    expect(spec.elements.angles).toHaveLength(3)
    expect(spec.elements.angles[0]).toMatchObject({
      center: 'O',
      ray1: 'A',
      ray2: 'C',
      color: 'red',
      arcRadius: 30,
    })
    expect(spec.elements.angles[1]).toMatchObject({
      center: 'B',
      ray1: 'A',
      ray2: 'C',
      style: 'square',
    })
    expect(spec.elements.angles[2]).toMatchObject({
      center: 'T',
      ray1: 'P',
      ray2: 'Q',
      label: { value: '100°', position: 'inside' },
    })
  })

  it('skips right-angle rows that only give a vertex with no rays, recording a warning', () => {
    const raw = [
      '  --- זוויות לתצוגה ---',
      '  * זווית A | קודקוד: A | סימון: ריבוע 90°',
      '  * זווית BOC | קודקוד: O | נמדדת בין: OB ל- OC',
    ].join('\n')

    const { spec, warnings } = parseGeometryDsl(raw)

    expect(spec.elements.angles).toHaveLength(1)
    expect(spec.elements.angles[0]).toMatchObject({ center: 'O', ray1: 'B', ray2: 'C' })
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('handles compressed segment lists like "* קטע AB, קטע BC, קטע CD"', () => {
    const raw = ['  --- ישרים וקטעים ---', '  * קטע AB, קטע BC, קטע CD, קטע DA'].join('\n')

    const { spec } = parseGeometryDsl(raw)

    expect(spec.elements.lines).toEqual([
      { from: 'A', to: 'B', style: 'solid' },
      { from: 'B', to: 'C', style: 'solid' },
      { from: 'C', to: 'D', style: 'solid' },
      { from: 'D', to: 'A', style: 'solid' },
    ])
  })

  it('captures a canvas grid when the row is present', () => {
    const raw = [
      '  --- קנבס ורשת ---',
      '  * רוחב קנבס: 400 | גובה קנבס: 300 | רשת (Grid): מופעל (גודל משבצת: 20 פיקסלים)',
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=100, Y=100',
    ].join('\n')

    const { spec } = parseGeometryDsl(raw)

    expect(spec.canvas).toMatchObject({ width: 400, height: 300, grid: true })
    expect(spec.elements.points).toHaveLength(1)
  })

  it('resolves right-angle markers to single-letter point names', () => {
    // Author writes "בין ישר EF לישר GH" — the ray tokens are 2-letter
    // segment refs where one letter is the vertex. The parser must strip
    // the vertex letter and emit the far endpoint as the ray, otherwise
    // the renderer can't resolve `ray1: 'EF'` to a point.
    const raw = [
      '  --- נקודות ---',
      '  * נקודה E | מיקום: X=280, Y=125',
      '  * נקודה F | מיקום: X=380, Y=125',
      '  * נקודה G | מיקום: X=330, Y=70',
      '  * נקודה H | מיקום: X=330, Y=180',
      '  * נקודה O | מיקום: X=330, Y=125',
      '  --- סימונים ---',
      '  * סימן זווית ישרה (90°) | קודקוד: O | בין ישר OE לישר OG',
    ].join('\n')

    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.angles).toHaveLength(1)
    expect(spec.elements.angles[0]).toMatchObject({
      center: 'O',
      ray1: 'E',
      ray2: 'G',
      style: 'square',
    })
  })

  it('records warnings for garbled rows without dropping later ones', () => {
    const raw = [
      '  --- נקודות ---',
      '  * complete garbage row',
      '  * נקודה A | מיקום: X=100, Y=100',
    ].join('\n')

    const { spec, warnings } = parseGeometryDsl(raw)

    expect(warnings.length).toBeGreaterThan(0)
    expect(spec.elements.points).toHaveLength(1)
    expect(spec.elements.points[0].name).toBe('A')
  })
})
