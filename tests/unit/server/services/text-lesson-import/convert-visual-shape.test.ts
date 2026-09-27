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
})
