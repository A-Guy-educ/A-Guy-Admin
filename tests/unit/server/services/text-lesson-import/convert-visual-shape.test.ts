import { describe, expect, it } from 'vitest'

import { convertTextExerciseV2ToSections } from '@/server/services/text-lesson-import/convert-text-exercise-v2'
import { parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'

const SEP = '='.repeat(40)

describe('v2 converter — emitted visual block shape', () => {
  it("stamps `displaySize: 'full'` on section-level geometry attachments", () => {
    // The admin AttachmentEditor sets displaySize:'full' when the author
    // manually attaches a sketch. Omitting it means the web renderer
    // silently drops the attachment even though the block imports cleanly.
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
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=100, Y=100',
      '* אפשרות 1: A [תשובה נכונה]',
      '* אפשרות 2: B',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const conv = convertTextExerciseV2ToSections(lesson.exercises[0])
    const questionBlock = conv.sections[0].blocks[0] as {
      type: string
      attachment?: { kind: string; displaySize?: string }
    }
    expect(questionBlock.type).toBe('question_select')
    expect(questionBlock.attachment).toMatchObject({
      kind: 'geometry',
      layout: 'textRight',
      displaySize: 'full',
    })
  })

  it("stamps `displaySize: 'full'` on the standalone exercise-level `question_geometry`", () => {
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '* שרטוט בסיס:',
      '  --- נקודות ---',
      '  * נקודה A | מיקום: X=100, Y=100',
      '',
      SEP,
      "[ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice',
      '* הנחיה: q',
      '* אפשרות 1: A [תשובה נכונה]',
      '* אפשרות 2: B',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const conv = convertTextExerciseV2ToSections(lesson.exercises[0])
    const geomBlock = conv.sharedBlocks.find(
      (b) => (b as { type: string }).type === 'question_geometry',
    )
    expect(geomBlock).toBeDefined()
    expect(geomBlock).toMatchObject({ displaySize: 'full', layout: 'textRight' })
  })

  it('inherits the exercise-level circle onto sections that reference it bare', () => {
    // Boss's per-section sketches redeclare points/segments in compressed
    // form and reference the shared circle by bare `* מעגל 1` (no `מרכז`).
    // The section's parsed geometry has zero circles until the converter
    // copies the exercise's shared circle in — otherwise the ring is missing
    // from every per-section attachment.
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '* שרטוט בסיס:',
      '  --- נקודות ---',
      '  * נקודה O | מיקום: X=200, Y=200',
      '  * נקודה A | מיקום: X=120, Y=120',
      '  --- מעגלים ---',
      '  * מעגל 1 | מרכז: O | רדיוס גרפי: 113 | צבע: שחור',
      '',
      SEP,
      "[ סעיף א' - שאלת ברירה יחידה ]",
      SEP,
      '* סוג השאלה: Single Choice',
      '* הנחיה: q',
      '* שרטוט מותאם לסעיף:',
      '  --- נקודות ---',
      '  * O (200,200), A (120,120)',
      '  --- מעגלים ---',
      '  * מעגל 1',
      '* אפשרות 1: A [תשובה נכונה]',
      '* אפשרות 2: B',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const conv = convertTextExerciseV2ToSections(lesson.exercises[0])
    const questionBlock = conv.sections[0].blocks[0] as {
      attachment?: { geometry?: { elements: { circles: Array<Record<string, unknown>> } } }
    }
    expect(questionBlock.attachment?.geometry?.elements.circles).toEqual([
      { center: 'O', style: 'solid', radius: 113, color: 'black' },
    ])
  })

  it('emits a `question_table` with solutionFill for `Fill-in Table` sections', () => {
    // Boss's proof-table template with two rows and a `[ שדה ריק - X ]` blank
    // in each. Regression against the old converter which emitted an
    // "unparsable" rich_text placeholder instead of a real question block.
    const source = [
      SEP,
      '[ תרגיל 1 - נתוני פתיחה ]',
      SEP,
      '* טקסט: intro',
      '',
      SEP,
      "[ סעיף ה' - שאלת השלמת טבלה ]",
      SEP,
      '* סוג השאלה: Fill-in Table',
      '* הנחיה: השלימו את הטבלה.',
      '* מבנה טבלה (עמודות: שלב, טענה, נימוק):',
      '  * שורה 1 | טענה: DE || BC | נימוק: [ שדה ריק - נתון ]',
      '  * שורה 2 | טענה: [ שדה ריק - להשלמה: זווית A = זווית A ] | נימוק: זווית משותפת',
    ].join('\n')

    const lesson = parseTextLessonV2(source)
    const conv = convertTextExerciseV2ToSections(lesson.exercises[0])
    const tableBlock = conv.sections[0].blocks[0] as {
      type: string
      table?: {
        solutionFill?: boolean
        headers?: string[]
        rowsData?: string[][]
        answers?: Record<string, string>
        showBorders?: boolean
        showHeader?: boolean
      }
    }
    expect(tableBlock.type).toBe('question_table')
    expect(tableBlock.table).toEqual({
      solutionFill: true,
      headers: ['שלב', 'טענה', 'נימוק'],
      rowsData: [
        ['1', 'DE || BC', ''],
        ['2', '', 'זווית משותפת'],
      ],
      answers: {
        '0-2': 'נתון',
        '1-1': 'זווית A = זווית A',
      },
      showBorders: true,
      showHeader: true,
    })
  })
})
