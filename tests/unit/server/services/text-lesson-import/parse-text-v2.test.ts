import { describe, expect, it } from 'vitest'

import { isV2Format, parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'

const SEP = '='.repeat(40)

describe('isV2Format', () => {
  it('recognises the "נתוני פתיחה" signature', () => {
    const text = `${SEP}\n[ תרגיל 1 - נתוני פתיחה ]\n${SEP}`
    expect(isV2Format(text)).toBe(true)
  })

  it('recognises the bracketed "סעיף" signature even without an exercise prefix', () => {
    const text = `${SEP}\n[ סעיף א' - שאלת ברירה יחידה ]\n${SEP}`
    expect(isV2Format(text)).toBe(true)
  })

  it('rejects the legacy "תרגיל 1 – מנחה: subtopic" format', () => {
    const text = `${'='.repeat(80)}\nתרגיל 1 – מנחה: היקף\n${'='.repeat(80)}`
    expect(isV2Format(text)).toBe(false)
  })

  it('recognises tight-bracket headers without inner whitespace', () => {
    expect(isV2Format(`${SEP}\n[תרגיל 1 - נתוני פתיחה]\n${SEP}`)).toBe(true)
    expect(isV2Format(`${SEP}\n[סעיף א' - שאלת ברירה יחידה]\n${SEP}`)).toBe(true)
  })

  it('does NOT falsely detect v1 legacy files as v2', () => {
    // v1 files use `================` fences with bare `תרגיל 1 – מנחה: subtopic`
    // exercise headers and `[תרגיל 1 - סעיף א]` section headers (no trailing
    // question-type suffix). Prior detection triggered on the `[…סעיף…]` shape
    // and routed the file to the v2 parser, which then collapsed all content
    // into a single synthetic exercise.
    const v1File = [
      '='.repeat(80),
      'תרגיל 1 – מנחה: הכרת ציר המספרים',
      '='.repeat(80),
      'שרטוט',
      '<svg>...</svg>',
      '',
      '-'.repeat(80),
      '[תרגיל 1 - סעיף א]',
      '-'.repeat(80),
      '* תוכן השאלה: מה הצבע?',
      '* אופציות:',
      '  - כחול',
      '  - אדום',
      '* פתרון נכון: כחול',
      '* סוג תרגיל: בחירה בין 2 אפשרויות',
    ].join('\n')
    expect(isV2Format(v1File)).toBe(false)
  })
})

describe('parseTextLessonV2 — basic shape', () => {
  it('parses an exercise with intro geometry and one MCQ section', () => {
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: בשרטוט שלפניכם שני ישרים.',
      '* שרטוט בסיס (מבנה אובייקטים):',
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=50, Y=50 | מיקום תווית: שמאל-למעלה | מוצגת: כן',
      '  * נקודה O | מיקום: X=200, Y=200 | מיקום תווית: מימין | מוצגת: כן',
      '  * נקודה C | מיקום: X=50, Y=350 | מיקום תווית: שמאל-למטה | מוצגת: כן',
      '  --- ישרים וקטעים ---',
      '  * קטע AO | מנקודה A לנקודה O',
      '',
      SEP,
      "[ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice',
      '* הנחיה: מהו הקשר בין הזוויות?',
      '* שרטוט מותאם לסעיף:',
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=50, Y=50 | מיקום תווית: שמאל-למעלה | מוצגת: כן',
      '  * נקודה O | מיקום: X=200, Y=200 | מיקום תווית: מימין | מוצגת: כן',
      '  --- זוויות לתצוגה ---',
      '  * זווית AOC | קודקוד: O | נמדדת בין: OA ל- OC | צבע: אדום | רדיוס: 30',
      '* אפשרות 1: זוויות קודקודיות [תשובה נכונה]',
      '* אפשרות 2: זוויות צמודות',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    expect(lesson.exercises).toHaveLength(1)

    const ex = lesson.exercises[0]
    expect(ex.exerciseNumber).toBe('1')
    expect(ex.headerRest).toBe('נתוני פתיחה')
    expect(ex.intro).toContain('שני ישרים')
    expect(ex.sharedGeometry).toBeDefined()
    expect(ex.sharedGeometry?.elements.points.map((p) => p.name)).toEqual(['A', 'O', 'C'])

    expect(ex.sections).toHaveLength(1)
    const sec = ex.sections[0]
    expect(sec.questionNumber).toBe("א'")
    expect(sec.headerRest).toBe('שאלת ברירה יחידה')
    expect(sec.type).toEqual({ kind: 'mcq', optionsCount: 2 })
    expect(sec.question).toContain('הקשר בין הזוויות')
    expect(sec.options).toEqual([
      { text: 'זוויות קודקודיות', correct: true },
      { text: 'זוויות צמודות', correct: false },
    ])
    expect(sec.geometry?.elements.angles).toHaveLength(1)
    expect(sec.geometry?.elements.angles[0]).toMatchObject({ center: 'O', color: 'red' })
  })

  it('classifies "Single Choice (3 Options)" as an mcq with 3 options', () => {
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      "[ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice (3 Options)',
      '* הנחיה: prompt',
      '* אפשרות 1: A',
      '* אפשרות 2: B [תשובה נכונה]',
      '* אפשרות 3: C',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const sec = lesson.exercises[0].sections[0]
    expect(sec.type).toEqual({ kind: 'mcq', optionsCount: 3 })
    expect(sec.options).toHaveLength(3)
    const correctIdx = sec.options.findIndex((o) => o.correct)
    expect(correctIdx).toBe(1)
  })

  it('classifies "Open Ended" as free_response and keeps geometry from the section', () => {
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      "[ תרגיל 1 - סעיף ד' - שאלה פתוחה ]",
      SEP,
      '* סוג השאלה: Open Ended',
      '* הנחיה: הסבירו…',
      '* שרטוט מותאם לסעיף:',
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=100, Y=100',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const sec = lesson.exercises[0].sections[0]
    expect(sec.type).toEqual({ kind: 'free_response' })
    expect(sec.options).toEqual([])
    expect(sec.geometry?.elements.points).toHaveLength(1)
  })

  it('accepts a section header without the "תרגיל N -" prefix', () => {
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      "[ סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice',
      '* הנחיה: prompt',
      '* אפשרות 1: A [תשובה נכונה]',
      '* אפשרות 2: B',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    expect(lesson.exercises[0].sections).toHaveLength(1)
    expect(lesson.exercises[0].sections[0].questionNumber).toBe("א'")
  })

  it("expands a multi-label section header ('א', ב', ג', ד'') into N sections", () => {
    const source = [
      SEP,
      '[ תרגיל 7 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      "[ סעיף א', ב', ג', ד' - כמו מקודם, שאלות על צלעות סמוכות ונגדיות ]",
      SEP,
      '',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    expect(lesson.exercises[0].sections).toHaveLength(4)
    expect(lesson.exercises[0].sections.map((s) => s.questionNumber)).toEqual([
      "א'",
      "ב'",
      "ג'",
      "ד'",
    ])
    for (const sec of lesson.exercises[0].sections) {
      expect(sec.question).toContain('כמו מקודם')
    }
  })

  it("accepts a non-standard 'סעיף 1 ויחיד' single-section header", () => {
    const source = [
      SEP,
      '[ תרגיל 3 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      '[ סעיף 1 ויחיד - שאלת השלמת טבלה ]',
      SEP,
      '* סוג השאלה: Fill-in Table',
      '* הנחיה: prompt',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    expect(lesson.exercises[0].sections).toHaveLength(1)
    expect(lesson.exercises[0].sections[0].questionNumber).toBe('1 ויחיד')
    expect(lesson.exercises[0].sections[0].headerRest).toBe('שאלת השלמת טבלה')
  })

  it('does NOT copy the shared exercise geometry onto sections without their own block', () => {
    // Previously the parser inherited exercise.sharedGeometry onto every
    // sibling section. The converter then emitted the shared drawing twice:
    // once via sharedBlocks and once as a per-section attachment. Fixture
    // has one exercise with a shared sketch and one section with no sketch
    // of its own — the section must NOT carry the geometry.
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '* שרטוט בסיס (מבנה אובייקטים):',
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=10, Y=10',
      '',
      SEP,
      "[ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice',
      '* הנחיה: prompt',
      '* אפשרות 1: A [תשובה נכונה]',
      '* אפשרות 2: B',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    expect(lesson.exercises[0].sharedGeometry?.elements.points).toHaveLength(1)
    expect(lesson.exercises[0].sections[0].geometry).toBeUndefined()
    expect(lesson.exercises[0].sections[0].svg).toBeUndefined()
  })

  it('captures raw <svg> inside `שרטוט בסיס` as sharedSvg, not a discarded DSL block', () => {
    // Generators emit inline SVG for pictorial scenes (a ladder against a
    // wall) where the DSL's point/segment vocabulary doesn't apply. Prior
    // parser dropped these because parseGeometryDsl returned hasContent:false.
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '* שרטוט בסיס:',
      '  <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">',
      '    <line x1="50" y1="250" x2="350" y2="250" stroke="brown"/>',
      '  </svg>',
      '',
      SEP,
      "[ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice',
      '* הנחיה: prompt',
      '* אפשרות 1: A [תשובה נכונה]',
      '* אפשרות 2: B',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    expect(lesson.exercises[0].sharedGeometry).toBeUndefined()
    expect(lesson.exercises[0].sharedSvg).toContain('<svg')
    expect(lesson.exercises[0].sharedSvg).toContain('</svg>')
    // Section stays clean — the sharedSvg is emitted at the exercise level only.
    expect(lesson.exercises[0].sections[0].svg).toBeUndefined()
  })

  it('keeps multi-line `פתרון מלא:` on fullSolution instead of spilling into question', () => {
    // The generator emits open-ended solutions as a multi-line block with
    // nested `*   subitem` bullets. Previously each continuation line was
    // appended to `question` because we only tracked the last matched key,
    // and `* subitem: value` shapes were treated as brand-new fields.
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      "[ תרגיל 1 - סעיף ד' - שאלה פתוחה ]",
      SEP,
      '* סוג השאלה: Open Ended',
      '* הנחיה: פרקו לגורמים את הביטוי m²+12m+36.',
      '* פתרון מלא:',
      '    נזהה את המבנה:',
      '    *   m² הוא הריבוע של m. (a=m)',
      '    *   36 הוא הריבוע של 6. (b=6)',
      '    *   12m הוא 2 כפול m כפול 6 (2ab).',
      '    לכן, הביטוי הוא ריבוע של סכום: (m+6)².',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const sec = lesson.exercises[0].sections[0]
    expect(sec.question).toBe('פרקו לגורמים את הביטוי m²+12m+36.')
    expect(sec.fullSolution).toContain('נזהה את המבנה')
    expect(sec.fullSolution).toContain('a=m')
    expect(sec.fullSolution).toContain('(m+6)²')
    expect(sec.question).not.toContain('נזהה את המבנה')
    expect(sec.question).not.toContain('a=m')
  })

  it('captures raw <svg> inside `שרטוט מותאם לסעיף` as a section-level svg field', () => {
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      "[ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice',
      '* הנחיה: prompt',
      '* שרטוט מותאם לסעיף:',
      '  <svg width="100" height="100"><rect/></svg>',
      '* אפשרות 1: A [תשובה נכונה]',
      '* אפשרות 2: B',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const sec = lesson.exercises[0].sections[0]
    expect(sec.geometry).toBeUndefined()
    expect(sec.svg).toContain('<svg')
  })
})
