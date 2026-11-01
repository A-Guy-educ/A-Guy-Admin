import { describe, expect, it } from 'vitest'

import type {
  HtmlBlock,
  QuestionSelectMcqBlock,
  RichTextBlock,
} from '@/server/payload/collections/Exercises/types'
import { buildCanonicalLessonExport } from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToText } from '@/server/services/lesson-export/to-text-format'
import { convertTextExerciseV2ToSections } from '@/server/services/text-lesson-import/convert-text-exercise-v2'
import { parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'
import { splitHtmlSegments } from '@/server/services/text-lesson-import/split-html-segments'

const EQ = '='.repeat(41)
const VERSE_CARD =
  '<div dir="rtl" lang="he" style="direction: rtl; border-radius: 12px;"><p style="margin: 0;">בראשית א׳ — פסוקים א, ב</p><p><strong>(א)</strong> בְּרֵאשִׁית בָּרָא אֱלֹהִים׃</p></div>'

function inline(value: string) {
  return { type: 'rich_text' as const, format: 'md-math-v1' as const, value, mediaIds: [] }
}

const SAMPLE = [
  'שם השיעור - בראשית א',
  '',
  EQ,
  '[ תרגיל 1 - נתוני פתיחה ]',
  EQ,
  '* טקסט:',
  'מה קורה בתחילת הסיפור?',
  'הפסוקים המוצגים הם קטעים נבחרים.',
  VERSE_CARD,
  '',
  EQ,
  '[ תרגיל 1 - סעיף א - Single Choice ]',
  EQ,
  '* סוג השאלה: Single Choice',
  '* הנחיה:',
  'מי פועל בפסוק א?',
  '* אפשרות 1: האדם',
  '* אפשרות 2: אלוהים [תשובה נכונה]',
].join('\n')

describe('splitHtmlSegments', () => {
  it('keeps text and html segments in source order', () => {
    expect(splitHtmlSegments(`לפני\n${VERSE_CARD}\nאחרי`)).toEqual([
      { kind: 'text', value: 'לפני' },
      { kind: 'html', value: VERSE_CARD },
      { kind: 'text', value: 'אחרי' },
    ])
  })

  it('keeps markup spread over several lines as one segment', () => {
    const html = '<div>\n  <p>שורה</p>\n  <br>\n</div>'
    expect(splitHtmlSegments(`${html}\nטקסט`)).toEqual([
      { kind: 'html', value: html },
      { kind: 'text', value: 'טקסט' },
    ])
  })

  it('leaves inline svg and math comparisons as text', () => {
    const value = '<svg viewBox="0 0 10 10"></svg>\n$x<y$'
    expect(splitHtmlSegments(value)).toEqual([{ kind: 'text', value }])
  })
})

describe('v2 text import with html', () => {
  it('turns pasted markup in the exercise intro into an html block', () => {
    const exercise = parseTextLessonV2(SAMPLE).exercises[0]
    const { sharedBlocks } = convertTextExerciseV2ToSections(exercise)

    expect(sharedBlocks.map((b) => b.type)).toEqual(['rich_text', 'html'])
    expect((sharedBlocks[0] as RichTextBlock).value).toBe(
      'מה קורה בתחילת הסיפור?\nהפסוקים המוצגים הם קטעים נבחרים.',
    )
    expect((sharedBlocks[1] as HtmlBlock).html).toBe(VERSE_CARD)
  })

  it('pulls markup out of a section question into an html block before it', () => {
    const text = SAMPLE.replace('מי פועל בפסוק א?', `${VERSE_CARD}\nמי פועל בפסוק א?`)
    const exercise = parseTextLessonV2(text).exercises[0]
    const { sections } = convertTextExerciseV2ToSections(exercise)

    const [html, mcq] = sections[0].blocks
    expect((html as HtmlBlock).html).toBe(VERSE_CARD)
    expect((mcq as QuestionSelectMcqBlock).prompt.value).toBe('**א.** מי פועל בפסוק א?')
  })
})

describe('v2 text export with html', () => {
  const mcq: QuestionSelectMcqBlock = {
    id: 'q-mcq',
    type: 'question_select',
    variant: 'mcq',
    selectionMode: 'single',
    prompt: inline('מי פועל?'),
    answer: {
      multiSelect: false,
      options: [
        { id: 'o1', content: inline('אלוהים') },
        { id: 'o2', content: inline('האדם') },
      ],
      correctOptionIds: ['o1'],
    },
  }

  function roundTrip(exerciseBlocks: unknown[], sectionBlocks: unknown[]) {
    const canonical = buildCanonicalLessonExport(
      { title: 'HTML', order: 1 },
      [{ id: 'ex-1', content: { blocks: exerciseBlocks } }],
      '',
      new Map([['ex-1', [{ id: 'sec-1', content: { blocks: sectionBlocks } }]]]),
    )
    const text = serializeLessonToText(canonical)
    const converted = convertTextExerciseV2ToSections(parseTextLessonV2(text).exercises[0])
    return { text, converted }
  }

  it('writes html blocks inline and reimports them as html blocks', () => {
    const { text, converted } = roundTrip(
      [
        { id: 'rt', type: 'rich_text', format: 'md-math-v1', value: 'פתיחה', mediaIds: [] },
        { id: 'h1', type: 'html', html: VERSE_CARD },
      ],
      [{ id: 'h2', type: 'html', html: VERSE_CARD }, mcq],
    )
    expect(text).toContain(`* טקסט: פתיחה\n${VERSE_CARD}`)

    expect(converted.sharedBlocks.map((b) => b.type)).toEqual(['rich_text', 'html'])
    expect((converted.sharedBlocks[1] as HtmlBlock).html).toBe(VERSE_CARD)

    const [html, question] = converted.sections[0].blocks
    expect((html as HtmlBlock).html).toBe(VERSE_CARD)
    expect((question as QuestionSelectMcqBlock).prompt.value).toBe('**א.** מי פועל?')
  })

  it('wraps markup that starts with bare text so it reimports as html', () => {
    const { converted } = roundTrip([{ id: 'h1', type: 'html', html: 'שלום <b>עולם</b>' }], [mcq])
    expect(converted.sharedBlocks).toHaveLength(1)
    expect((converted.sharedBlocks[0] as HtmlBlock).html).toBe('<div>שלום <b>עולם</b></div>')
  })
})
