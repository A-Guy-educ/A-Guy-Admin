/**
 * Seed data for the lesson "ייצוג אלגברי של קו ישר — מבוא" (Algebraic
 * Representation of a Line — Introduction).
 *
 * @fileType seed-data
 * @domain lessons
 * @pattern issue-212
 * @ai-summary Creates a learning lesson in the geometry chapter of the
 * "הכנה לכיתה ז (TEST)" course with 9 content pages (4 headings, 4
 * paragraphs, 1 SVG) and 12 exercises (10 multiple-choice + 2 free-response).
 * Each exercise embeds its own question content via the `question_select`
 * (mcq variant) or `question_free_response` block types. The lesson's
 * `blocks` playlist references the content pages and exercises in the
 * pedagogical order specified by issue #212.
 *
 * Schema mapping note: the issue's spec described block types like
 * `heading`/`paragraph`/`svg`/`mcq`/`free` inside the lesson `blocks`
 * field, but the current schema only accepts `exerciseRef` /
 * `contentPageRef` references there. Heading/paragraph/SVG content is
 * therefore stored as ContentPages with HtmlBlock bodies, and MCQ/free
 * content is stored as Exercises with `question_select` (mcq) or
 * `question_free_response` blocks.
 */

import type {
  ContentBlock,
  InlineRichText,
  QuestionFreeResponseBlock,
  QuestionSelectMcqBlock,
} from '@/server/payload/collections/Exercises/types'

export const ALGEBRAIC_LINE_INTRO_LESSON = {
  slug: 'algebraic-representation-line-intro',
  title: 'ייצוג אלגברי של קו ישר — מבוא',
  chapterId: '18509e3e2746091012a71cbe',
  courseId: '8b35e70f2f9aa28cefc52f5f',
  order: 3,
  description:
    'מבוא לייצוג אלגברי של קו ישר במישור — מתחיל מנקודות ומערכת צירים, מגלה את הכלל האלגברי של הקו מתוך שתי נקודות. ללא שימוש במושג "משוואת ישר".',
} as const

/**
 * Pedagogical forbidden-words guard: the issue forbids the terms
 * "משוואה" (equation) and "שיפוע" (slope) throughout the lesson. A unit
 * test asserts none of the seeded strings contain either substring.
 */
export const FORBIDDEN_WORDS = ['משוואה', 'שיפוע'] as const

const rt = (value: string): InlineRichText => ({
  type: 'rich_text',
  format: 'md-math-v1',
  value,
  mediaIds: [],
})

const mcqOption = (id: string, value: string) => ({ id, content: rt(value) })

/**
 * Returns the 9 content pages that wrap the lesson's pedagogical text
 * (4 headings, 4 paragraphs, 1 SVG). Each entry is the `body` payload
 * for a ContentPage — a single HtmlBlock carrying the rendered HTML.
 */
export function getAlgebraicLineIntroContentPages(): Array<{
  key: string
  title: string
  body: Array<{ blockType: 'html'; html: string }>
}> {
  return [
    {
      key: 'heading-1',
      title: 'כותרת: מקו ישר לכלל אלגברי',
      body: [
        {
          blockType: 'html',
          html: '<h2>מקו ישר לכלל אלגברי</h2>',
        },
      ],
    },
    {
      key: 'paragraph-1',
      title: 'פתיחה: נקודות על קו',
      body: [
        {
          blockType: 'html',
          html:
            '<p>היום נדבר על קווים ישרים — אבל לא בעיפרון ונייר. נדבר עליהם בשפה של <strong>נקודות</strong>.</p>' +
            '<p><strong>שאלת חימום:</strong> הנקודות <code>(0,0), (1,1), (2,2)</code> — האם כולן על אותו קו ישר? מה מיוחד בנקודות האלה?</p>' +
            '<p><em>תשובה צפויה: כן, הן יוצרות קו אלכסוני, במרחק שווה זו מזו.</em></p>',
        },
      ],
    },
    {
      key: 'heading-2',
      title: 'כותרת: בלוק 1 — קוליניאריות',
      body: [
        {
          blockType: 'html',
          html: '<h2>בלוק 1: קוליניאריות — ניסוי וטעייה</h2>',
        },
      ],
    },
    {
      key: 'paragraph-2',
      title: 'הסבר: קוליניאריות',
      body: [
        {
          blockType: 'html',
          html: '<p>נקודות הן <strong>קוליניאריות</strong> אם כולן נמצאות על אותו קו ישר.</p>',
        },
      ],
    },
    {
      key: 'svg-1',
      title: 'איור: שלוש קבוצות נקודות על מישור',
      body: [
        {
          blockType: 'html',
          html:
            '<figure>' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 360" role="img" aria-label="שלוש קבוצות נקודות על מערכת צירים">' +
            '<rect x="0" y="0" width="500" height="360" fill="#ffffff" />' +
            // Axes
            '<line x1="40" y1="300" x2="480" y2="300" stroke="#222" stroke-width="1.5" />' +
            '<line x1="60" y1="20" x2="60" y2="340" stroke="#222" stroke-width="1.5" />' +
            // Grid ticks (light)
            '<g stroke="#dcdcdc" stroke-width="0.5">' +
            Array.from(
              { length: 21 },
              (_, i) => `<line x1="${60 + i * 20}" y1="20" x2="${60 + i * 20}" y2="300" />`,
            ).join('') +
            Array.from(
              { length: 14 },
              (_, i) => `<line x1="60" y1="${20 + i * 20}" x2="480" y2="${20 + i * 20}" />`,
            ).join('') +
            '</g>' +
            // Group A (collinear) — y = x, points (1,1), (2,2), (3,3), (4,4)
            '<g fill="#1f7a3a">' +
            '<circle cx="80" cy="280" r="5" />' +
            '<circle cx="100" cy="260" r="5" />' +
            '<circle cx="120" cy="240" r="5" />' +
            '<circle cx="140" cy="220" r="5" />' +
            '<line x1="80" y1="280" x2="140" y2="220" stroke="#1f7a3a" stroke-dasharray="4 4" stroke-width="1" />' +
            '<text x="160" y="225" font-size="14" fill="#1f7a3a">קבוצה א׳ — קוליניארית</text>' +
            '</g>' +
            // Group B (not collinear) — mostly diagonal but (3,5) breaks it
            '<g fill="#b1281d">' +
            '<circle cx="60" cy="300" r="5" />' +
            '<circle cx="100" cy="260" r="5" />' +
            '<circle cx="120" cy="200" r="5" />' +
            '<circle cx="140" cy="220" r="5" />' +
            '<text x="160" y="195" font-size="14" fill="#b1281d">קבוצה ב׳ — לא קוליניארית (3,5)</text>' +
            '</g>' +
            // Group C (collinear) — y = 2x + 1, points (1,3), (2,5), (3,7), (5,11)
            '<g fill="#1d4fb1">' +
            '<circle cx="80" cy="240" r="5" />' +
            '<circle cx="100" cy="200" r="5" />' +
            '<circle cx="120" cy="160" r="5" />' +
            '<circle cx="160" cy="80" r="5" />' +
            '<line x1="80" y1="240" x2="160" y2="80" stroke="#1d4fb1" stroke-dasharray="4 4" stroke-width="1" />' +
            '<text x="180" y="85" font-size="14" fill="#1d4fb1">קבוצה ג׳ — קוליניארית</text>' +
            '</g>' +
            // Axis labels
            '<text x="475" y="320" font-size="14" fill="#222">x</text>' +
            '<text x="45" y="30" font-size="14" fill="#222">y</text>' +
            '</svg>' +
            '<figcaption>שלוש קבוצות נקודות. קבוצה ב׳ היא היחידה שאינה קוליניארית.</figcaption>' +
            '</figure>',
        },
      ],
    },
    {
      key: 'heading-3',
      title: 'כותרת: בלוק 2 — משתי נקודות לכלל',
      body: [
        {
          blockType: 'html',
          html: '<h2>בלוק 2: משתי נקודות לכלל</h2>',
        },
      ],
    },
    {
      key: 'paragraph-3',
      title: 'הסבר: גילוי הכלל מתוך שתי נקודות',
      body: [
        {
          blockType: 'html',
          html:
            '<p>אם נתונות לנו שתי נקודות על קו ישר, אפשר לגלות מה הכלל של הקו.</p>' +
            '<p><strong>דוגמה מובלת:</strong> נקודה א׳: <code>(0, 2)</code>; נקודה ב׳: <code>(1, 5)</code>.</p>' +
            '<p>מ-<code>(0,2)</code> ל-<code>(1,5)</code>: x גדל ב-1, y גדל ב-3. <strong>קצב</strong> = 3. הנקודה <code>(0, 2)</code> נותנת את הערך 2.</p>' +
            '<p><strong>הכלל:</strong> <code>y = 3x + 2</code></p>',
        },
      ],
    },
    {
      key: 'heading-4',
      title: 'כותרת: בלוק 3 — כיוון הקו',
      body: [
        {
          blockType: 'html',
          html: '<h2>בלוק 3: כיוון הקו</h2>',
        },
      ],
    },
    {
      key: 'paragraph-4',
      title: 'הסבר: כיוון הקו + סיכום',
      body: [
        {
          blockType: 'html',
          html:
            '<p>מתי הקו עולה? מתי יורד? מתי אופקי? תלוי במה שמופיע לפני x.</p>' +
            '<p><strong>סיכום:</strong> היום למדנו שכל קו ישר במישור הוא אוסף של נקודות קוליניאריות. מספיקות שתי נקודות כדי לגלות את הכלל האלגברי של הקו. הכלל תמיד נראה <code>y = mx + b</code> — ועדיין לא נתנו לזה שם מיוחד.</p>',
        },
      ],
    },
  ]
}

/**
 * Builds a `question_select` (mcq variant) block with `single` selection
 * mode. Options are 1-indexed strings (`o1`, `o2`, ...) by convention.
 */
function buildMcq(args: {
  id: string
  prompt: string
  options: Array<{ id: string; text: string }>
  correctOptionId: string
}): QuestionSelectMcqBlock {
  return {
    id: args.id,
    type: 'question_select',
    variant: 'mcq',
    selectionMode: 'single',
    prompt: rt(args.prompt),
    answer: {
      multiSelect: false,
      options: args.options.map((o) => mcqOption(o.id, o.text)),
      correctOptionIds: [args.correctOptionId],
    },
  }
}

function buildFreeResponse(args: {
  id: string
  prompt: string
  acceptedAnswers: string[]
}): QuestionFreeResponseBlock {
  return {
    id: args.id,
    type: 'question_free_response',
    prompt: rt(args.prompt),
    answer: { acceptedAnswers: args.acceptedAnswers },
  }
}

/**
 * Returns the 12 exercises for the algebra lesson in pedagogical order.
 * Exercises 1–4 and 6–11 are multiple-choice, exercises 5 and 12 are
 * free-response. The index in the returned array matches the issue's
 * numbering (block 6 → exercise 4, block 10 → exercise 5, ...).
 */
export function getAlgebraicLineIntroExercises(): Array<{
  key: string
  title: string
  contentBlocks: ContentBlock[]
}> {
  return [
    {
      key: 'ex-1',
      title: 'תרגיל 1: זיהוי קוליניאריות — קבוצה א׳',
      contentBlocks: [
        buildMcq({
          id: 'ex-1-q',
          prompt: 'הנקודות `(1,1), (2,2), (3,3), (4,4)` הן:',
          options: [
            { id: 'o1', text: 'קוליניאריות — על אותו קו ישר' },
            { id: 'o2', text: 'לא קוליניאריות — הנקודה האחרונה לא שייכת' },
            { id: 'o3', text: 'יוצרות עקומה (לא קו)' },
            { id: 'o4', text: 'יוצרות שני קווים שונים' },
          ],
          correctOptionId: 'o1',
        }),
      ],
    },
    {
      key: 'ex-2',
      title: 'תרגיל 2: זיהוי קוליניאריות — קבוצה ב׳',
      contentBlocks: [
        buildMcq({
          id: 'ex-2-q',
          prompt: 'הנקודות `(0,0), (2,2), (3,5), (4,4)` הן:',
          options: [
            { id: 'o1', text: 'קוליניאריות — על אותו קו ישר' },
            { id: 'o2', text: 'לא קוליניאריות — הנקודה `(3,5)` לא שייכת' },
            { id: 'o3', text: 'קוליניאריות רק בזוגות' },
            { id: 'o4', text: 'לא ניתן לקבוע בלי לשרטט' },
          ],
          correctOptionId: 'o2',
        }),
      ],
    },
    {
      key: 'ex-3',
      title: 'תרגיל 3: זיהוי קוליניאריות — קבוצה ג׳',
      contentBlocks: [
        buildMcq({
          id: 'ex-3-q',
          prompt: 'הנקודות `(1,3), (2,5), (3,7), (5,11)` הן:',
          options: [
            { id: 'o1', text: 'קוליניאריות' },
            { id: 'o2', text: 'לא קוליניאריות — הנקודה `(5,11)` חורגת' },
            { id: 'o3', text: 'לא קוליניאריות — הנקודה `(1,3)` חורגת' },
            { id: 'o4', text: 'יוצרות שתי קבוצות נפרדות' },
          ],
          correctOptionId: 'o1',
        }),
      ],
    },
    {
      key: 'ex-4',
      title: 'תרגיל 4: איזו קבוצה אינה קוליניארית',
      contentBlocks: [
        buildMcq({
          id: 'ex-4-q',
          prompt: 'איזו מהקבוצות אינה קוליניארית?',
          options: [
            { id: 'o1', text: 'קבוצה א׳: `(1,1), (2,2), (3,3), (4,4)`' },
            { id: 'o2', text: 'קבוצה ב׳: `(0,0), (2,2), (3,5), (4,4)`' },
            { id: 'o3', text: 'קבוצה ג׳: `(1,3), (2,5), (3,7), (5,11)`' },
            { id: 'o4', text: 'כולן קוליניאריות' },
          ],
          correctOptionId: 'o2',
        }),
      ],
    },
    {
      key: 'ex-5',
      title: 'תרגיל 5: גילוי הכלל מתוך שתי נקודות',
      contentBlocks: [
        buildFreeResponse({
          id: 'ex-5-q',
          prompt: 'מצאו את הכלל של הקו העובר דרך `(0, -1)` ו-`(3, 8)`. הסבירו איך מצאתם.',
          acceptedAnswers: ['y = 3x − 1', 'y = 3x - 1', 'y=3x-1', 'y=3x−1'],
        }),
      ],
    },
    {
      key: 'ex-6',
      title: 'תרגיל 6: זיהוי הכלל — (0,4) ו-(1,7)',
      contentBlocks: [
        buildMcq({
          id: 'ex-6-q',
          prompt: 'מה הכלל של הקו העובר דרך `(0, 4)` ו-`(1, 7)`?',
          options: [
            { id: 'o1', text: '`y = 3x + 3`' },
            { id: 'o2', text: '`y = 4x + 3`' },
            { id: 'o3', text: '`y = 3x + 4`' },
            { id: 'o4', text: '`y = 7x`' },
          ],
          correctOptionId: 'o3',
        }),
      ],
    },
    {
      key: 'ex-7',
      title: 'תרגיל 7: זיהוי הכלל — (0,5) ו-(2,11)',
      contentBlocks: [
        buildMcq({
          id: 'ex-7-q',
          prompt: 'מה הכלל של הקו העובר דרך `(0, 5)` ו-`(2, 11)`?',
          options: [
            { id: 'o1', text: '`y = 5x + 5`' },
            { id: 'o2', text: '`y = 3x + 5`' },
            { id: 'o3', text: '`y = 2x + 5`' },
            { id: 'o4', text: '`y = 6x + 5`' },
          ],
          correctOptionId: 'o2',
        }),
      ],
    },
    {
      key: 'ex-8',
      title: 'תרגיל 8: כיוון הקו — y = 4x − 1',
      contentBlocks: [
        buildMcq({
          id: 'ex-8-q',
          prompt: 'הקו `y = 4x − 1` — מה הכיוון שלו?',
          options: [
            { id: 'o1', text: 'עולה' },
            { id: 'o2', text: 'יורד' },
            { id: 'o3', text: 'אופקי' },
          ],
          correctOptionId: 'o1',
        }),
      ],
    },
    {
      key: 'ex-9',
      title: 'תרגיל 9: כיוון הקו — y = −2x + 5',
      contentBlocks: [
        buildMcq({
          id: 'ex-9-q',
          prompt: 'הקו `y = −2x + 5` — מה הכיוון שלו?',
          options: [
            { id: 'o1', text: 'עולה' },
            { id: 'o2', text: 'יורד' },
            { id: 'o3', text: 'אופקי' },
          ],
          correctOptionId: 'o2',
        }),
      ],
    },
    {
      key: 'ex-10',
      title: 'תרגיל 10: כיוון הקו — y = 7',
      contentBlocks: [
        buildMcq({
          id: 'ex-10-q',
          prompt: 'הקו `y = 7` — מה הכיוון שלו?',
          options: [
            { id: 'o1', text: 'עולה' },
            { id: 'o2', text: 'יורד' },
            { id: 'o3', text: 'אופקי' },
          ],
          correctOptionId: 'o3',
        }),
      ],
    },
    {
      key: 'ex-11',
      title: 'תרגיל 11: בדיקת קוליניאריות — (2,3), (4,5), (6,9)',
      contentBlocks: [
        buildMcq({
          id: 'ex-11-q',
          prompt: 'האם `(2,3), (4,5), (6,9)` על אותו קו?',
          options: [
            { id: 'o1', text: 'כן — כולן על אותו קו' },
            { id: 'o2', text: 'לא — הנקודה `(4,5)` לא שייכת' },
            { id: 'o3', text: 'לא — הנקודה `(6,9)` לא שייכת' },
            { id: 'o4', text: 'לא — הנקודה `(2,3)` לא שייכת' },
          ],
          correctOptionId: 'o2',
        }),
      ],
    },
    {
      key: 'ex-12',
      title: 'תרגיל 12: קו דרך הראשית — בחירה אישית',
      contentBlocks: [
        buildFreeResponse({
          id: 'ex-12-q',
          prompt:
            'בחרו קו ישר שעובר דרך הראשית `(0,0)`. רשמו את הכלל שלו ו-3 נקודות שעליו. הסבירו למה בחרתם בכלל הזה.',
          acceptedAnswers: [
            'y = 2x',
            'y = 3x',
            'y = 4x',
            'y = 5x',
            'y = x',
            'y = 0.5x',
            'y = 1.5x',
          ],
        }),
      ],
    },
  ]
}

/**
 * Builds the JSON `blocks` string for the lesson — an ordered playlist
 * of `contentPageRef` and `exerciseRef` entries. Content pages and
 * exercises are referenced by `__key__` placeholders that the runner
 * script replaces with real IDs after creating the documents.
 */
export function getAlgebraicLineIntroBlocksTemplate(): string {
  // Order matches the issue's pedagogical sequence:
  // heading → paragraph → heading → paragraph → svg → mcq(4) → heading →
  // paragraph → paragraph-worked-example → free(5) → heading → paragraph →
  // mcq(8/9/10) → heading → paragraph(summary) → mcq(11) → free(12)
  const order = [
    { kind: 'contentPage', key: 'heading-1' },
    { kind: 'contentPage', key: 'paragraph-1' },
    { kind: 'contentPage', key: 'heading-2' },
    { kind: 'contentPage', key: 'paragraph-2' },
    { kind: 'contentPage', key: 'svg-1' },
    { kind: 'exercise', key: 'ex-1' },
    { kind: 'exercise', key: 'ex-2' },
    { kind: 'exercise', key: 'ex-3' },
    { kind: 'exercise', key: 'ex-4' },
    { kind: 'contentPage', key: 'heading-3' },
    { kind: 'contentPage', key: 'paragraph-3' },
    { kind: 'exercise', key: 'ex-5' },
    { kind: 'contentPage', key: 'heading-4' },
    { kind: 'exercise', key: 'ex-6' },
    { kind: 'exercise', key: 'ex-7' },
    { kind: 'exercise', key: 'ex-8' },
    { kind: 'exercise', key: 'ex-9' },
    { kind: 'exercise', key: 'ex-10' },
    { kind: 'contentPage', key: 'paragraph-4' },
    { kind: 'exercise', key: 'ex-11' },
    { kind: 'exercise', key: 'ex-12' },
  ] as const

  // Render as a template string so the runner can post-process id
  // placeholders. We use a sentinel for id (the runner generates one),
  // and `__KEY__` for the contentPage/exercise keys.
  const templateBlocks = order.map((entry, index) => ({
    id: `__BLOCK_${index}__`,
    blockType: entry.kind === 'exercise' ? 'exerciseRef' : 'contentPageRef',
    ...(entry.kind === 'exercise'
      ? { exercise: `__EXERCISE_${entry.key}__` }
      : { contentPage: `__CONTENT_PAGE_${entry.key}__` }),
  }))

  return JSON.stringify(templateBlocks)
}
