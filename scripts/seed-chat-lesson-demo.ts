/**
 * Seed the demo chat-lesson script (Hebrew).
 *
 * Target lesson: 7th-grade-prep-decimal-fraction-structure
 *   id      6a703d20e077f10c83010e39
 *   tenant  AGuy default
 *   locale  he
 *
 * Ported from A-Guy-Web/src/app/(frontend)/.../ChatLessonView/demoLesson.ts so
 * the Chat tab has real, authored content to render instead of the bundled
 * hardcoded demo.
 *
 * Idempotent — upserts by (lesson, locale).
 *
 * Usage: npx tsx scripts/seed-chat-lesson-demo.ts
 */
import { getPayload } from 'payload'
import config from '@payload-config'

import { getDefaultTenantId } from '@/server/repos/tenant/get-default-tenant'

const LESSON_ID = '6a703d20e077f10c83010e39'
const LOCALE = 'he'

const chatScript = {
  highlights: 'התמצאות בציר, השוואת שברים, סימנים כפולים ומשוואות חסרות',
  steps: [
    {
      blockType: 'multipleChoice',
      stepId: 'personality',
      text: 'שלום! אני A-Guy, המורה הדיגיטלי שלך למתמטיקה. באיזה סגנון הוראה נתחיל היום?',
      options: [
        {
          text: 'מורה קשוח וממוקד',
          feedback: 'מצוין. נתחיל מיד, אין לנו זמן לבזבז.',
          nextStepId: 'how_are_you',
        },
        {
          text: 'מורה חברותי ומסביר',
          feedback: 'איזה כיף לפגוש אותך! נלמד היום ברוגע ובסבלנות, צעד אחר צעד.',
          nextStepId: 'how_are_you',
        },
        {
          text: 'מורה קצר וענייני',
          feedback: 'מעולה. ניגש ישר לחומר ונפתור את זה ביעילות.',
          nextStepId: 'how_are_you',
        },
      ],
    },
    {
      blockType: 'multipleChoice',
      stepId: 'how_are_you',
      text: 'אז אחרי שהכרנו — מה שלומך ואיך האנרגיה שלך היום?',
      options: [
        {
          text: 'מצוין, מלא מרץ',
          feedback: 'נהדר, ננצל את הכוח הזה כדי לרוץ קדימה!',
          nextStepId: 'goal',
        },
        {
          text: 'קצת עייף אבל נסתדר',
          feedback: 'מובן לגמרי. נהיה ממוקדים ונעשה את זה קל ומהיר.',
          nextStepId: 'goal',
        },
      ],
    },
    {
      blockType: 'multipleChoice',
      stepId: 'goal',
      text: 'מה תרצה שנעשה בשיעור היום?',
      options: [
        {
          text: 'ללמוד חומר חדש מהיסוד',
          feedback: 'בחירה מצוינת. היום נלמד את הבסיס של מספרים מכוונים.',
          nextStepId: 'intro_ex1',
        },
        {
          text: 'לעשות חזרה ולתרגל',
          feedback: 'מעולה — תרגול מביא לשליטה. נפתור יחד את התרגילים הראשונים.',
          nextStepId: 'intro_ex1',
        },
      ],
    },
    {
      blockType: 'teacherIntro',
      stepId: 'intro_ex1',
      text: 'נתחיל עם תרגיל 1 — התמצאות על ציר המספרים.',
      contentHtml:
        '<div class="p-card-padding-sm bg-primary/5 rounded-2xl border border-primary/20">' +
        '<h3 class="text-body-lg font-bold text-primary mb-2">🧭 ציר המספרים המכוונים</h3>' +
        '<p class="text-body-md text-foreground leading-relaxed">' +
        'במספרים שליליים הכל עובד "הפוך": ככל שהמספר נראה גדול יותר (בלי המינוס), הוא בעצם ' +
        '<strong>קטן יותר</strong> — כי הוא נמצא שמאלה יותר על הציר.' +
        '</p></div>',
      nextStepId: 'ex1_a',
    },
    {
      blockType: 'multipleChoice',
      stepId: 'ex1_a',
      text: 'איזה מהמספרים הבאים הוא מספר שלם הקטן מ־$-2$?',
      correctionText:
        'שים לב: מספר שקטן מ־$-2$ חייב להימצא שמאלה ממנו על הציר. לכן $-3$ הוא הנכון.',
      options: [
        {
          text: '$-1$',
          isCorrect: false,
          feedback: 'לא נכון. $-1$ נמצא מימין ל־$-2$ ולכן גדול ממנו.',
          nextStepId: 'ex1_b',
        },
        {
          text: '$-3$',
          isCorrect: true,
          feedback: 'מעולה! $-3$ נמצא משמאל ל־$-2$ ולכן קטן ממנו.',
          nextStepId: 'ex1_b',
        },
      ],
    },
    {
      blockType: 'multipleChoice',
      stepId: 'ex1_b',
      text: 'איזה מהמספרים הוא מספר שלילי שלם הגדול מ־$-4$?',
      correctionText:
        'מספר גדול יותר בציר השליליים = קרוב יותר לאפס. $-3$ קרוב יותר לאפס מ־$-4$.',
      options: [
        {
          text: '$-3$',
          isCorrect: true,
          feedback: 'נכון! $-3$ קרוב יותר לאפס ונמצא מימין ל־$-4$.',
          nextStepId: 'ex1_c',
        },
        {
          text: '$-5$',
          isCorrect: false,
          feedback: 'לא נכון — $-5$ נמצא משמאל ל־$-4$ ולכן קטן ממנו.',
          nextStepId: 'ex1_c',
        },
      ],
    },
    {
      blockType: 'textAnswer',
      stepId: 'ex1_c',
      text: 'כתוב את המספר השלם הקטן ביותר הגדול מ־$-10$.',
      expected: '-9',
      correctFeedback: 'מדויק! $-9$ קרוב יותר לאפס מ־$-10$ ולכן גדול ממנו.',
      correctionText: 'התשובה הנכונה היא $-9$: הוא צעד אחד מימין ל־$-10$ על הציר.',
      nextStepId: 'finish',
    },
    {
      blockType: 'finish',
      stepId: 'finish',
      text: 'כל הכבוד! סיימת את היחידה הראשונה 🎉',
      contentHtml:
        '<div class="p-card-padding-sm bg-success/10 rounded-2xl border border-success/30">' +
        '<p class="text-body-md text-foreground">' +
        'עברת את הבסיס של מספרים מכוונים. בפעם הבאה נמשיך להשוואת שברים וסימנים כפולים.' +
        '</p></div>',
    },
  ],
}

async function main() {
  const payload = await getPayload({ config })

  const lesson = await payload.findByID({
    collection: 'lessons',
    id: LESSON_ID,
    overrideAccess: true,
    depth: 0,
  })
  if (!lesson) {
    throw new Error(`Lesson ${LESSON_ID} not found — cannot seed chat script.`)
  }

  const tenantId = await getDefaultTenantId(payload)

  const existing = await payload.find({
    collection: 'chat-lessons',
    where: {
      and: [{ lesson: { equals: LESSON_ID } }, { locale: { equals: LOCALE } }],
    },
    limit: 1,
    overrideAccess: true,
  })

  const data = {
    lesson: LESSON_ID,
    locale: LOCALE,
    tenant: tenantId,
    status: 'published' as const,
    isActive: true,
    ...chatScript,
  }

  if (existing.docs[0]) {
    const doc = existing.docs[0]
    await payload.update({
      collection: 'chat-lessons',
      id: doc.id,
      data: data as never,
      overrideAccess: true,
    })
    payload.logger.info(`Updated chat-lesson for lesson ${LESSON_ID} (doc ${doc.id})`)
  } else {
    const created = await payload.create({
      collection: 'chat-lessons',
      data: data as never,
      overrideAccess: true,
    })
    payload.logger.info(`Created chat-lesson for lesson ${LESSON_ID} (doc ${created.id})`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('Failed to seed chat-lesson demo:', err)
  process.exit(1)
})
