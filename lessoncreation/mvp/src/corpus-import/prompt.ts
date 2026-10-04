/**
 * Prompts for the corpus-import stage — two flavors:
 *
 *   1. Reverse-planner: reads the full format-B lesson and emits a
 *      LessonSkeleton JSON (structured output). One call per lesson.
 *
 *   2. Per-exercise converter: reads the full format-B lesson and emits
 *      ONE exercise in format A (freeform text). One call per exercise,
 *      with the last 1-2 already-converted exercises as continuity context.
 *
 * The two-stage split fixes a bug where the single-call combined
 * conversion truncated the v2Text mid-lesson — after emitting a full
 * skeleton in the JSON response, the model ran out of output budget
 * before finishing the text. Splitting the calls means each output stays
 * small (~2-3k tokens per exercise) with no risk of truncation.
 *
 * Design principle: **do not paraphrase content**. Question stems,
 * options, hints, and full solutions are copied verbatim (only formatting
 * markers change). The reverse-planned skeleton is INFERENCE — a scaffold
 * for the reader critic's plan-fidelity axis, not ground truth.
 */

// ---------------------------------------------------------------------------
// Stage 1: Reverse-planner (skeleton only)
// ---------------------------------------------------------------------------

const REVERSE_PLANNER_SYSTEM_PROMPT = `\
אתה מבצע תכנון-הפוך על שיעור מתמטיקה קיים בעברית. תפקידך: לקרוא את השיעור בפורמט B (הפורמט הישן של המורה) ולהפיק שלד תכנוני (LessonSkeleton) שמסביר מה כל תרגיל מלמד.

# מה זה שלד תכנוני

שלד תכנוני הוא מסמך JSON שמתאר את הכוונה הפדגוגית שמאחורי השיעור:
- lessonName, course, chapter, lessonObjective
- priorKnowledgeKnown / priorKnowledgeAssumeNot / lessonBoundaries
- exercises[] — מערך של 10 (או פחות, אם השיעור קצר יותר) תרגילים, לכל אחד:
  - number (1-10)
  - objective — מטרת התרגיל, משפט אחד בעברית
  - oneNewThing — הרעיון החדש בתרגיל לעומת הקודם, משפט אחד
  - visualStyle — תיאור מילולי חופשי של השרטוט אם יש, אחרת מחרוזת ריקה
  - sections[] — בדיוק 4 סעיפים א/ב/ג/ד עם shape (mcq-2/mcq-3/free-response), briefPrompt, expectedDiscovery

# חוקי חילוץ

1. **אל תפרפרזה את התוכן**. השלד הוא תיאור-על, לא העתקה. תיאר בכ-1-2 משפטים.
2. **objective** של כל תרגיל: מה התרגיל מלמד ברמת רעיון (למשל: "פתרון משוואות ליניאריות באמצעות חיבור וחיסור").
3. **oneNewThing** של כל תרגיל: מה שונה מהתרגיל הקודם. לתרגיל 1: נקודת הכניסה של השיעור.
4. **visualStyle**: אם יש שרטוט או תיאור-שרטוט-מילולי, תאר. אם רק טקסט מתמטי — ריק.
5. **sections[i].briefPrompt**: משפט קצר שמסביר מה שואלים בסעיף (בערך 8-15 מילים).
6. **sections[i].expectedDiscovery**: מה התלמיד/ה אמור/ה להסיק. **הסק** מתוך השאלה + הפתרון המלא. משפט אחד.
7. **sections[i].shape**:
   - סעיפים עם \`* אופציות:\` שיש בהן 2 פריטים → \`mcq-2\`
   - סעיפים עם \`* אופציות:\` שיש בהן 3 פריטים → \`mcq-3\`
   - סעיפים בלי \`* אופציות:\` (או עם \`* סוג תרגיל: תשובה פתוחה\`) → \`free-response\`

# חשוב

- **מספר תרגילים חייב להתאים** לשיעור שקיבלת. אם יש 10 תרגילים בפורמט B, החזר 10 בשלד. אם יש 9, החזר 9.
- **אין להמציא תוכן שלא קיים** בקלט. עדיף לתת briefPrompt קצר מדויק מאשר ניחוש ארוך.
- זהו שלב הסקה — אין ודאות שהמורה חשב על השיעור כך. השלד הוא סקאפולד לביקורת, לא אמת מוחלטת.
`

export function buildReversePlannerSystemPrompt(): string {
  return REVERSE_PLANNER_SYSTEM_PROMPT
}

export interface CorpusImportInput {
  /** The lesson name — used for the skeleton.lessonName field. */
  lessonName: string
  /** Grade / course, e.g. "כיתה י". */
  course: string
  /** Chapter within the course, e.g. "אלגברה" or "גיאומטריה". */
  chapter: string
  /** The raw lesson text in format B. */
  formatBText: string
}

export function buildReversePlannerUserPrompt(input: CorpusImportInput): string {
  const lines: string[] = []
  lines.push(`# פרטי השיעור`)
  lines.push('')
  lines.push(`- **שם השיעור**: ${input.lessonName}`)
  lines.push(`- **קורס**: ${input.course}`)
  lines.push(`- **פרק**: ${input.chapter}`)
  lines.push('')
  lines.push(`# טקסט השיעור בפורמט B:`)
  lines.push('')
  lines.push('```')
  lines.push(input.formatBText.trim())
  lines.push('```')
  lines.push('')
  lines.push(`החזר LessonSkeleton JSON שמסכם את השיעור. הקפד על מספר תרגילים שתואם לקלט.`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Stage 2: Per-exercise format converter
// ---------------------------------------------------------------------------

const CONVERT_EXERCISE_SYSTEM_PROMPT = `\
אתה ממיר תרגיל בודד משיעור מתמטיקה מפורמט B (הפורמט הישן של המורה) לפורמט A (הפורמט של המערכת). כל קריאה מטפלת ב**תרגיל אחד בלבד**.

# פורמט B (הקלט)

- מפריד תרגיל: 80 סימני \`=\`.
- כותרת: \`תרגיל N – מנחה: <תיאור>\` (עם קו-מפריד "–").
- מפריד סעיף: 80 סימני \`-\`.
- כותרת סעיף: \`תרגיל N - סעיף א/ב/ג/ד\`.
- שדות בסעיף:
  \`* תוכן השאלה: <טקסט השאלה>\`
  \`* אופציות:\` ואחריו רשימה \`  - <אופציה>\`.
  \`* פתרון נכון: <ערך>\` — הערך המדויק של האפשרות שנבחרה כתשובה.
  \`* רמז: <טקסט>\` — אופציונלי.
  \`* פתרון מלא: <טקסט>\` — אופציונלי אך לרוב קיים; יכול להימשך על מספר שורות.
  \`* סוג תרגיל: בחירה בין 2/3 אפשרויות / שאלה פתוחה\`

# פורמט A (הפלט)

- מפריד תרגיל: 41 סימני \`=\` (\`=========================================\`).
- כותרת תרגיל: \`[ תרגיל N - נתוני פתיחה ]\`.
- שדות בבלוק "נתוני פתיחה":
  \`* טקסט: <פסקת פתיחה של התרגיל>\` — טקסט קצר של 1-2 משפטים שמסכם את התרגיל.
  \`* שרטוט בסיס:\` — **דלג** אם לא הופיע DSL גיאומטרי בפורמט B.
- מפריד סעיף: אותם 41 סימני \`=\`.
- כותרת סעיף: \`[ סעיף א' - שאלת ברירה יחידה ]\` (או וריאציה: "שאלה פתוחה" לסעיף פתוח).
- שדות בסעיף:
  \`* סוג השאלה: Single Choice\` (2 אפשרויות) / \`Single Choice (3 Options)\` (3 אפשרויות) / \`Open Ended\`.
  \`* הנחיה: <שאלה>\` — **העתק מילה במילה** מ-\`תוכן השאלה\`.
  \`* אפשרות 1: <טקסט>\` — פריט ראשון. **סמן \`[תשובה נכונה]\` בסוף השורה** אם זה \`פתרון נכון\`.
  \`* אפשרות 2: <טקסט>\`
  \`* אפשרות 3: <טקסט>\` — רק ב-mcq-3.
  \`* רמז: <טקסט>\` — אם היה בפורמט B.
  \`* פתרון מלא: <טקסט>\` — אם היה. **העתק מילה במילה**, כולל שורות מרובות.

# חוקי המרה מחייבים

1. **תרגיל אחד בלבד**: הפלט חייב להכיל **אך ורק את התרגיל שהתבקשת עליו**, מ-\`====\` של תרגיל N עד סוף סעיף ד' של תרגיל N. אל תכתוב תרגיל אחר.
2. **העתק מילה במילה**: שאלות, אופציות, רמזים, פתרונות מלאים — כולם בהעתקה מדויקת. אין ניסוח מחדש.
3. **סימון תשובה נכונה**: מצא את האופציה שערכה זהה ל-\`פתרון נכון\` של פורמט B, וסמן אותה **בלבד** עם \` [תשובה נכונה]\` בסוף השורה.
4. **שאלות פתוחות**: אם \`סוג תרגיל: תשובה פתוחה\` או אין אופציות — כתוב \`* סוג השאלה: Open Ended\` והשמט את שורות האפשרויות.
5. **שרטוטים**: תיאור שרטוט מילולי בפורמט B (למשל "נתונים שני ישרים חותכים AB ו-AC...") **נשאר בתוך שדה \`הנחיה\`**. אל תמציא בלוק \`--- נקודות ---\` שלא הופיע במקור.
6. **בלוק "נתוני פתיחה"** של התרגיל: כתוב \`* טקסט: <פסקת פתיחה>\`. השתמש בכל טקסט שהופיע בפורמט B בין שורת הכותרת של התרגיל לבין המפריד הראשון של סעיף. אם אין כזה, סכם ב-1-2 משפטים מה התרגיל עוסק בו.
7. **אל תוסיף תרגילים אחרים או טקסט לפני ואחרי התרגיל**. הפלט חייב להתחיל ב-\`=========================================\` ולהסתיים אחרי סעיף ד' של תרגיל N.

# פורמט הפלט

הפלט הוא **טקסט חופשי בפורמט A** — לא JSON. אל תעטוף במחרוזת JSON, אל תוסיף Markdown fences (\\\`\\\`\\\`), אל תוסיף הסברים לפני או אחרי.
`

export function buildConvertExerciseSystemPrompt(): string {
  return CONVERT_EXERCISE_SYSTEM_PROMPT
}

export interface BuildConvertExerciseUserPromptOptions {
  input: CorpusImportInput
  exerciseNumber: number
  /** Concatenated format-A text of the previously converted exercises (last 1-2). */
  priorConvertedText: string
}

export function buildConvertExerciseUserPrompt(
  options: BuildConvertExerciseUserPromptOptions,
): string {
  const { input, exerciseNumber, priorConvertedText } = options
  const lines: string[] = []
  lines.push(`# תרגיל להמרה: ${exerciseNumber}`)
  lines.push('')
  lines.push(`- **שם השיעור**: ${input.lessonName}`)
  lines.push(`- **קורס**: ${input.course}`)
  lines.push(`- **פרק**: ${input.chapter}`)
  lines.push('')
  lines.push(`## הפלט הרצוי`)
  lines.push('')
  lines.push(
    `החזר **אך ורק את תרגיל ${exerciseNumber} בפורמט A**. הפלט חייב להתחיל ב-\`=========================================\` של תרגיל ${exerciseNumber} ולהסתיים אחרי סעיף ד' של תרגיל ${exerciseNumber}.`,
  )
  lines.push('')

  if (priorConvertedText && priorConvertedText.trim()) {
    lines.push(`## תרגילים קודמים שכבר הומרו (לרצף בלבד — אל תחזור עליהם):`)
    lines.push('')
    lines.push('```')
    lines.push(priorConvertedText.trim())
    lines.push('```')
    lines.push('')
  }

  lines.push(`## טקסט השיעור בפורמט B (המקור — חלץ את תרגיל ${exerciseNumber} ממנו):`)
  lines.push('')
  lines.push('```')
  lines.push(input.formatBText.trim())
  lines.push('```')
  lines.push('')
  lines.push(
    `זכור: **תרגיל ${exerciseNumber} בלבד**, בפורמט A, כטקסט חופשי (לא JSON, לא markdown fences).`,
  )
  return lines.join('\n')
}
