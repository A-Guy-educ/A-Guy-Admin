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

  it('accepts `תווית` as a segment label alongside `ערך`', () => {
    // The generator pipeline emits `תווית: <label>` while hand-authored
    // curriculum files use `ערך: <label>`. Both must land on `line.label`.
    const raw = [
      '  --- ישרים וקטעים ---',
      '  * קטע AB | מנקודה A לנקודה B | תווית: 8 ס"מ',
      '  * קטע BC | מנקודה B לנקודה C | ערך: 4 ס"מ',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.lines).toEqual([
      { from: 'A', to: 'B', style: 'solid', label: { value: '8 ס"מ', position: 'm' } },
      { from: 'B', to: 'C', style: 'solid', label: { value: '4 ס"מ', position: 'm' } },
    ])
  })

  it('parses angle rows where the fields lack colons and use `צלעות` for rays', () => {
    // Generator variant: `קודקוד B` and `צלעות BA, BC` — no colons after
    // the field name. `תווית` provides the arc label (not `ערך`).
    const raw = [
      '  --- זוויות ---',
      '  * זווית ABC | קודקוד B | צלעות BA, BC | מידה: 50 | תווית: 50 מעלות',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.angles).toHaveLength(1)
    expect(spec.elements.angles[0]).toMatchObject({
      center: 'B',
      ray1: 'A',
      ray2: 'C',
      label: { value: '50 מעלות', position: 'inside' },
    })
  })

  it('parses angle rows that use separate `צלע1` / `צלע2` fields', () => {
    const raw = [
      '  --- זוויות ---',
      '  * זווית X | קודקוד: X | צלע1: XY | צלע2: XZ | מידה: 45',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.angles).toHaveLength(1)
    expect(spec.elements.angles[0]).toMatchObject({
      center: 'X',
      ray1: 'Y',
      ray2: 'Z',
      label: { value: '45', position: 'inside' },
    })
  })

  it('emits a boundingBox fitted to the actual points with ~10% padding', () => {
    // Without a boundingBox, the renderer falls back to the full canvas
    // ([0, height, width, 0]) and small shapes render as tiny fragments in
    // a corner. Fit the viewport to the point extents so the drawing fills
    // the available area.
    const raw = [
      '  --- נקודות ---',
      '  * נקודה A | X=150, Y=100',
      '  * נקודה B | X=200, Y=200',
      '  * נקודה C | X=100, Y=200',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    // Points span x∈[100,200] (range 100) and y∈[100,200] (range 100).
    // 10% padding → 10 on each side. JSXGraph order: [xMin, yMax, xMax, yMin].
    expect(spec.canvas.boundingBox).toEqual([90, 210, 210, 90])
  })

  it('pads flat axes with a fixed amount so the boundingBox is never zero-range', () => {
    const raw = [
      '  --- נקודות ---',
      '  * נקודה A | X=100, Y=100',
      '  * נקודה B | X=200, Y=100', // all points share the same Y — flat axis
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    const bb = spec.canvas.boundingBox
    expect(bb).toBeDefined()
    const [xMin, yMax, xMax, yMin] = bb!
    expect(xMax - xMin).toBeGreaterThan(0)
    expect(yMax - yMin).toBe(40)
  })

  it('grows the boundingBox to include a numeric-radius circle', () => {
    // A ring around the last point would previously get clipped because the
    // auto-fit only looked at point coordinates. Radius = 50 pushes the box
    // out from the [200, 200] center to [150..250] on each axis.
    const raw = [
      '  --- נקודות ---',
      '  * נקודה A | X=100, Y=100',
      '  * נקודה O | X=200, Y=200',
      '  --- מעגלים ---',
      '  * מעגל 1 | מרכז: O | רדיוס גרפי: 50',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    // x∈[100, 250] (range 150) and y∈[100, 250] (range 150).
    // 10% padding → 15 on each side.
    expect(spec.canvas.boundingBox).toEqual([85, 265, 265, 85])
  })

  it('grows the boundingBox to include a `עובר דרך` circle', () => {
    // Center O = (100, 100), through A = (100, 160) → radius = 60.
    // Box before circle: x∈[100, 100], y∈[100, 160] (flat x).
    // After circle: x∈[40, 160], y∈[40, 160].
    const raw = [
      '  --- נקודות ---',
      '  * נקודה O | X=100, Y=100',
      '  * נקודה A | X=100, Y=160',
      '  --- מעגלים ---',
      '  * מעגל | מרכז: O | עובר דרך: A',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    // xRange = 120, yRange = 120 → 12 padding on each side.
    expect(spec.canvas.boundingBox).toEqual([28, 172, 172, 28])
  })

  it('ignores circles whose center is not a local point (inherited/unresolved)', () => {
    // Section-attachment style: circle references a center defined at the
    // exercise level. The block itself only has a stray label point; the
    // circle center `O` isn't resolvable so the fit must not crash and must
    // fall back to the point-only extents.
    const raw = [
      '  --- נקודות ---',
      '  * נקודה A | X=100, Y=100',
      '  * נקודה B | X=200, Y=200',
      '  --- מעגלים ---',
      '  * מעגל | מרכז: O | רדיוס גרפי: 500',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.canvas.boundingBox).toEqual([90, 210, 210, 90])
  })

  it('omits boundingBox when the block has no points (SVG-only paths)', () => {
    const raw = ['  --- ישרים וקטעים ---', '  * קטע AB | מנקודה A ל-B'].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.canvas.boundingBox).toBeUndefined()
  })

  it('does not confuse `מיקום` with the sibling `מיקום תווית` field', () => {
    // Boss-format v1 geometry rows omit the `מיקום:` key and inline the
    // coordinates as `X=…, Y=…` directly, while the label position lives
    // in a separate `מיקום תווית:` field. Prior findField logic accepted
    // `מיקום ` (with trailing space) as a prefix and returned the label
    // position ("למעלה") as the coordinate value, dropping every point.
    const raw = [
      '  --- נקודות ---',
      '  * נקודה A | X=170, Y=40 | מיקום תווית: למעלה | צבע: שחור',
      '  * נקודה B | X=50, Y=260 | מיקום תווית: שמאל-למטה | צבע: שחור',
    ].join('\n')

    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.points).toEqual([
      { name: 'A', x: 170, y: 40, position: 't', color: 'black' },
      { name: 'B', x: 50, y: 260, position: 'bl', color: 'black' },
    ])
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

  it('parses `סימן קטעים שווים AB, AC` into an equalSegments group', () => {
    const raw = ['  --- סימונים ---', '  * סימן קטעים שווים AB, AC'].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.equalSegments).toEqual([
      [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
      ],
    ])
  })

  it('parses `סימן זוויות שוות BAD, CAD` and stub-references matching angles', () => {
    // `BAD` and `CAD` are 3-letter angle names (endpoint-vertex-endpoint).
    // Both share the vertex `A`. The parser resolves them to indices in
    // the `angles` array, pushing stubs if the angle wasn't listed under
    // `--- זוויות ---`.
    const raw = ['  --- סימונים ---', '  * סימן זוויות שוות BAD, CAD'].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.angles).toEqual([
      { center: 'A', ray1: 'B', ray2: 'D' },
      { center: 'A', ray1: 'C', ray2: 'D' },
    ])
    expect(spec.elements.equalAngles).toEqual([[0, 1]])
  })

  it('parses the boss-template `* שוויון צלעות | DN, BM | סימון: קו אחד` row', () => {
    // Newer marker shape emitted by the boss's generator: the head is just
    // the label (`שוויון צלעות` / `שוויון קטעים`), and the equal segments
    // live in a pipe-separated field. The `סימון: <style>` suffix carries
    // the marker-tick style ("קו אחד" / "שני קווים") — the current schema
    // has no field for style, so we accept and drop it.
    const raw = ['  --- סימונים ---', '  * שוויון צלעות | DN, BM | סימון: קו אחד'].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.equalSegments).toEqual([
      [
        { from: 'D', to: 'N' },
        { from: 'B', to: 'M' },
      ],
    ])
  })

  it('parses multiple `* שוויון צלעות` rows as distinct equality groups', () => {
    // Parallelogram fixture: opposite sides AB=CD (one-tick) and AD=BC
    // (two-tick) are two SEPARATE equality groups, not one group of four
    // segments. Marker-tick style differs per row and is dropped.
    const raw = [
      '  --- סימונים ---',
      '  * שוויון צלעות | AB, CD | סימון: קו אחד',
      '  * שוויון צלעות | AD, BC | סימון: שני קווים',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.equalSegments).toEqual([
      [
        { from: 'A', to: 'B' },
        { from: 'C', to: 'D' },
      ],
      [
        { from: 'A', to: 'D' },
        { from: 'B', to: 'C' },
      ],
    ])
  })

  it('parses `* שוויון זוויות | DAB, BCD | סימון: קשת אחת` into equalAngles', () => {
    const raw = ['  --- סימונים ---', '  * שוויון זוויות | DAB, BCD | סימון: קשת אחת'].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.angles).toEqual([
      { center: 'A', ray1: 'D', ray2: 'B' },
      { center: 'C', ray1: 'B', ray2: 'D' },
    ])
    expect(spec.elements.equalAngles).toEqual([[0, 1]])
  })

  it('parses `* מעגל 1 | מרכז: O | רדיוס גרפי: 113 | צבע: שחור | עובי: 2` into a circle', () => {
    // Full circle definition used at the exercise level (`שרטוט בסיס`).
    // `רדיוס גרפי` is the canvas-pixel radius the renderer uses; `עובי`
    // (thickness) has no schema counterpart and is dropped intentionally.
    const raw = [
      '  --- מעגלים ---',
      '  * מעגל 1 | מרכז: O | רדיוס גרפי: 113 | צבע: שחור | עובי: 2',
    ].join('\n')
    const { spec, bareCircleRefs } = parseGeometryDsl(raw)
    expect(spec.elements.circles).toEqual([
      { center: 'O', style: 'solid', radius: 113, color: 'black' },
    ])
    expect(bareCircleRefs).toEqual([])
  })

  it('captures bare `* מעגל 1` rows as unresolved references', () => {
    // The boss's per-section sketches reference the exercise-level circle by
    // bare ID with no `מרכז` field. The parser can't resolve it on its own,
    // so it records the ID in `bareCircleRefs` for the converter to inherit
    // the exercise's shared circle from.
    const raw = ['  --- מעגלים ---', '  * מעגל 1'].join('\n')
    const { spec, bareCircleRefs, hasContent } = parseGeometryDsl(raw)
    expect(spec.elements.circles).toEqual([])
    expect(bareCircleRefs).toEqual(['1'])
    expect(hasContent).toBe(true)
  })

  it('parses `* וקטור AB | מנקודה A לנקודה B | צבע: שחור | עובי: 2` into a vector', () => {
    // The vectors group shares the `--- ישרים וקטעים ---` header with
    // segments, but each `* וקטור` row needs to land in `vectors` (so the
    // renderer draws an arrowhead) instead of `lines`.
    const raw = [
      '  --- ישרים וקטעים ---',
      '  * קטע AB | מנקודה A לנקודה B | צבע: שחור',
      '  * וקטור CD | מנקודה C לנקודה D | צבע: שחור | עובי: 2',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.lines).toEqual([{ from: 'A', to: 'B', style: 'solid', color: 'black' }])
    expect(spec.elements.vectors).toEqual([{ from: 'C', to: 'D', thickness: 2, color: 'black' }])
  })

  it('parses `* קטע מקווקו DC` (head-level dashed marker) as a dashed segment', () => {
    // The boss's updated template writes dashed style between the keyword
    // and the endpoints: `* קטע מקווקו DC` / `* וקטור מקווקו AD | ...`.
    // Previously the inline-AB regex couldn't skip past `מקווקו` to reach
    // the letters, so every such row was dropped with "Skipped segment row".
    const raw = [
      '  --- ישרים וקטעים ---',
      '  * קטע מקווקו DC',
      '  * וקטור מקווקו AD | מנקודה A לנקודה D | צבע: שחור | עובי: 2',
    ].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.lines).toEqual([{ from: 'D', to: 'C', style: 'dashed' }])
    expect(spec.elements.vectors).toEqual([
      { from: 'A', to: 'D', style: 'dashed', thickness: 2, color: 'black' },
    ])
  })

  it("parses bare `* קטע A'B'` with primed point names on both sides", () => {
    // Boss's per-section sketches use primed point names (A', B', …) for
    // the back face of a parallelepiped. The old inline-AB shortcut only
    // captured single letters, so `* קטע A'B'` resolved to `AB` (prime
    // dropped). Now both sides accept an optional `'` / `′` suffix.
    const raw = ['  --- ישרים וקטעים ---', "  * קטע A'B'", "  * וקטור AA'"].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.lines).toEqual([{ from: "A'", to: "B'", style: 'solid' }])
    expect(spec.elements.vectors).toEqual([{ from: 'A', to: "A'" }])
  })

  it('parses bare `* וקטור AB` using the inline-letter shortcut', () => {
    // The boss's per-section sketches emit vectors as bare `* וקטור AB` with
    // no `מנקודה/לנקודה` fields — endpoints come from the two letters after
    // `וקטור` directly. Mirrors the compressed-segment behaviour.
    const raw = ['  --- ישרים וקטעים ---', '  * וקטור AB', '  * וקטור CD'].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.vectors).toEqual([
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
    ])
    expect(spec.elements.lines).toEqual([])
  })

  it('emits a circle for `* מעגל | מרכז: O | עובר דרך: A | מקווקו: כן`', () => {
    // Alternative form: no numeric ID, radius implied via a `עובר דרך`
    // point reference, and dashed style. `through` is a point name (schema
    // accepts string), and the parser flips `style` to `dashed`.
    const raw = ['  --- מעגלים ---', '  * מעגל | מרכז: O | עובר דרך: A | מקווקו: כן'].join('\n')
    const { spec } = parseGeometryDsl(raw)
    expect(spec.elements.circles).toEqual([{ center: 'O', style: 'dashed', through: 'A' }])
  })
})
