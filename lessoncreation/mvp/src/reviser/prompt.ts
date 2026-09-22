/**
 * Prompts for the reviser stage. The reviser is called with:
 *   - The original skeleton (as read-only context)
 *   - The critic's findings that need fixing
 *   - The exercise numbers to regenerate (subset of 1..10)
 *
 * It returns ONLY the patched exercises. The caller merges them into the
 * original skeleton at the same positions.
 *
 * The reviser MUST NOT change exercises that weren't flagged. It sees
 * their content only as context so its patched exercise can bridge to
 * E±1 smoothly.
 */
import type { CriticVerdict, ExerciseFinding } from '../critic/schema.js'
import type { LessonSkeleton } from '../planner/schema.js'

const SYSTEM_PROMPT = `\
אתה מתקן שלד של שיעור. מקבל שלד קיים + ממצאי ביקורת + רשימת תרגילים לתיקון. **תפקידך: לכתוב מחדש רק את התרגילים שסומנו — ולא לגעת בשאר.**

# כללים חשובים

## סוד המקצוע: תיקון מקומי
- אתה מקבל את **כל 10 התרגילים** כקונטקסט, אבל אתה מייצר **רק את התרגילים המסומנים**.
- החלק המרכזי בתפקידך: לוודא שהתרגיל החדש **מתחבר לתרגיל שלפניו** (E-1) ו**מוביל לתרגיל שאחריו** (E+1). אלה **קפואים** — לא לגעת בהם.
- אם המתקן שלך "שובר" את הרצף אל E+1 — כלומר, התרגיל החדש שלך מלמד רעיון שלא יבוסס ב-E+1 — תפסת בסלע. עדיף לתקן חלקית מאשר לפרק את הרצף.

## הכללים שאתה חייב להיצמד אליהם
כל התרגילים בשיעור — כולל אלה שאתה מתקן — חייבים לעמוד ב:
1. **סעיף ד = גילוי, לא רפלקציה**: אל תתחיל ב-"הסבר", "תאר במילים". במקום זה: "מצאו…", "הציבו…", "ציירו…", "בנו…".
2. **visualStyle לא-ריק** — במיוחד בתרגיל שמוסיף רעיון חדש. אם הביקורת ציינה "visualStyle empty" בתרגיל שאתה מתקן — חובה למלא אותו בתיאור חזותי קונקרטי.
3. **רעיון חדש אחד** — לא שניים. אם נראה לך שהתרגיל דורש שני שינויים — סימן שצריך לבטא רעיון אחד בלבד, ואת השני להשאיר לתרגיל אחר.
4. **בגוף ראשון רבים**: "אנחנו נגלה", "נבחין", "נחשב". לא "התלמיד/ה".
5. **מבנה סעיפים קבוע**: א' (mcq-2), ב' (mcq-2), ג' (mcq-3), ד' (free-response).
6. **גיל**: אל תיכנס לחומר מעבר לרמת השיעור. אין x², אין ריבועיות, אין הוכחות פורמליות (כיתה ז'-ח').

## מה אתה מקבל, מה אתה מחזיר
- **מקבל**: skeleton מלא + verdict.findings + סט של exerciseNumbers לתיקון (רק אלה שהם CRITICAL או HIGH).
- **מחזיר**: JSON עם patchedExercises — מערך של ExercisePlan, אחד לכל exerciseNumber ברשימת התיקון.
- **חשוב**: השדה \`number\` בכל ExercisePlan שאתה מייצר חייב להתאים למספר של התרגיל שאתה מחליף (לא לשנות למספר אחר).

## איך לגשת ל-suggestedFix של הביקורת
- הביקורת נותנת לך suggestedFix ספציפי. **כבד אותו** — הוא נכתב על ידי מבקר שראה את השיעור כולו.
- אם ה-suggestedFix אומר "החלף visualStyle ב-<תיאור>" — עשה זאת בדיוק.
- אם ה-suggestedFix אומר "פצל את הרעיון לשני תרגילים" — **אל תעשה זאת**. פיצול משנה את מספר התרגילים בשיעור. במקום זה, תקן את התרגיל הנוכחי כך שיוסיף רק חלק אחד מהרעיון, והשאר יידחה לאיטרציה הבאה של המבקר.
- אם ה-suggestedFix מציע פעולה שסותרת את הרצף (E-1 או E+1) — התאם את התיקון כך שיישמר הרצף.

## מקרים מיוחדים
- **תרגיל 10**: אם הוא בתיקון, ודא שהוא באמת סינתזה — מזכיר במפורש שני רעיונות מ-1-6 ואחד מ-7-9. סעיף ד' של תרגיל 10 חייב לחזור למקור החזותי, לא "המציאו סיטואציה משלכם".
- **תרגילים 1-2**: אם הם בתיקון, ודא שהם תפיסתיים בלבד — ללא ספירה, ללא חישוב, ללא ערכים מספריים. visualStyle לא צריך "לזמין ספירה" (למשל, לא לחלק צורות לריבועים קטנים).

## שמירה על תחום השיעור (החשוב ביותר לתיקון מקומי!)
- אל תכניס אובייקטים מתמטיים שאינם מופיעים בתרגילים הקפואים או שאינם צעד טבעי מהם. דוגמאות של הפרה: הכנסת רצף ריבועי לשיעור על רצפים לינאריים, הכנסת משולש לשיעור על מלבנים, הכנסת כפל לשיעור על חיבור.
- אם ה-suggestedFix של המבקר גובל בזה — **דחה** והצע תיקון מוגבל יותר באותו רעיון קיים.

## עיקרון החזרה המינימלית
- **שנה כמה שפחות** בתרגיל שאתה מתקן. תקן רק את מה שהמבקר ציין. אל "תשפר" חלקים שלא נשברו.
- שאיפה: אם הביקורת הצביעה על visualStyle ריק — הוסף visualStyle ותשאיר את שאר התרגיל כמו שהיה.
- שינוי גדול = יותר סיכון לפגוע ברצף לתרגילים סמוכים = יותר ממצאים באיטרציה הבאה.

הפלט חייב להיות JSON התואם ל-responseSchema — { patchedExercises: [ExercisePlan, ...] }.
`

export function buildReviserSystemPrompt(): string {
  return SYSTEM_PROMPT
}

export function buildReviserUserPrompt(
  skeleton: LessonSkeleton,
  verdict: CriticVerdict,
  targetExerciseNumbers: number[],
): string {
  const targetSet = new Set(targetExerciseNumbers)
  const relevantFindings = verdict.findings.filter((f) => targetSet.has(f.exerciseNumber))

  const lines: string[] = []
  lines.push(`# שיעור לתיקון: ${skeleton.lessonName}`)
  lines.push(`**קורס**: ${skeleton.course} | **פרק**: ${skeleton.chapter}`)
  lines.push(`**מטרת שיעור**: ${skeleton.lessonObjective}`)
  lines.push('')
  lines.push(`# תרגילים לתיקון (חובה לייצר כל אחד מהם מחדש):`)
  lines.push(`**${targetExerciseNumbers.join(', ')}**`)
  lines.push('')
  lines.push(`# ממצאי המבקר לתרגילים אלה:`)
  for (const f of relevantFindings) {
    lines.push('')
    lines.push(`## תרגיל ${f.exerciseNumber} — [${f.severity}] ${f.rule}`)
    lines.push(`**בעיה**: ${f.issue}`)
    lines.push(`**הצעת תיקון**: ${f.suggestedFix}`)
  }
  lines.push('')
  lines.push(`# השלד המלא (הקשר קפוא — אל תשנה אף תרגיל שלא ברשימת התיקון):`)
  lines.push('')

  for (const ex of skeleton.exercises) {
    const marker = targetSet.has(ex.number) ? '🔧 TO-FIX' : '❄️ FROZEN'
    lines.push(`## תרגיל ${ex.number} — ${marker}`)
    lines.push(`- objective: ${ex.objective}`)
    lines.push(`- oneNewThing: ${ex.oneNewThing}`)
    lines.push(`- visualStyle: ${ex.visualStyle || '(ריק)'}`)
    for (const sec of ex.sections) {
      lines.push(`  - ${sec.letter}' (${sec.shape}): ${sec.briefPrompt}`)
      lines.push(`    → ${sec.expectedDiscovery}`)
    }
    lines.push('')
  }
  lines.push('')
  lines.push(
    `# הפלט שלך: JSON עם שדה patchedExercises = מערך של ExercisePlan. כלול רק את התרגילים שברשימת התיקון, בסדר עולה של exercise number.`,
  )

  return lines.join('\n')
}

/** Extract the exercise numbers the reviser must patch — the ones with CRITICAL or HIGH severity. */
export function pickTargetExercises(verdict: CriticVerdict): number[] {
  const numbers = new Set<number>()
  for (const f of verdict.findings) {
    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') {
      // Exercise 0 = lesson-level; can't patch a whole lesson through this
      // path, so skip.
      if (f.exerciseNumber >= 1 && f.exerciseNumber <= 10) numbers.add(f.exerciseNumber)
    }
  }
  return Array.from(numbers).sort((a, b) => a - b)
}
