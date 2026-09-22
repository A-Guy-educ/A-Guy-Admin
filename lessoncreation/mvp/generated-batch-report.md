# Batch report — 10-lesson grade-10 run

**Total wall time:** 38.4 minutes

## Summary

| Outcome | Count |
|---|---|
| ✅ PASS-CLEAN (0 findings) | 4/10 |
| ☑️ PASS-WITH-NOTES (≤1 HIGH) | 3/10 |
| ⚠️ HALT (>1 HIGH after 3 iterations) | 3/10 |
| ❌ Pipeline errored | 0/10 |
| Writer parse-clean output | 10/10 |
| Writer parse-failed output | 0/10 |

## Per-lesson breakdown

### משוואות ריבועיות: מבוא
- **Chapter:** משוואות ריבועיות
- **Prev / Next:** (none) → פירוק לגורמים: הוצאת גורם משותף
- **Outcome:** PASS_WITH_NOTES in 2 iter, 221.7s
- **Writer:** ✅ parses
  - iter 1: CRIT:0 HIGH:5 MED:2 → patched [1,2,5,8]
  - iter 2: CRIT:0 HIGH:1 MED:0 → no patches
  - **Residual notes for human reviewer:**
    - [HIGH] E5 (sequential-buildup): תרגיל 5 מציג את המשוואה בצורה ax² + bx = 0 (מקרה פרטי שבו c=0) במקום את הצורה הסטנדרטית המלאה ax² + bx + c = 0, מה שיוצר חפיפה עם תרגיל 6 העוסק במקרים של מקדמים אפס.
- **Artifacts:**
  - Skeleton: `generated-skeletons/משוואות-ריבועיות-מבוא.json`
  - Lesson text: `generated-lessons/משוואות-ריבועיות-מבוא.txt`
  - Verdict trace: `generated-verdicts/משוואות-ריבועיות-מבוא.iter*.json`

### פירוק לגורמים: הוצאת גורם משותף
- **Chapter:** משוואות ריבועיות
- **Prev / Next:** משוואות ריבועיות: מבוא → פירוק לגורמים: נוסחאות כפל מקוצר
- **Outcome:** HALT in 3 iter, 291.4s
- **Writer:** ✅ parses
  - iter 1: CRIT:1 HIGH:3 MED:1 → patched [1,2,6,8]
  - iter 2: CRIT:2 HIGH:2 MED:2 → patched [1,2,8]
  - iter 3: CRIT:0 HIGH:2 MED:1 → no patches
  - **Residual notes for human reviewer:**
    - [HIGH] E8 (sequential-buildup): קיימת קפיצה מושגית גדולה בין הוצאת גורם משותף שהוא איבר בודד (אפילו עם חזקה) לבין הוצאת גורם משותף שהוא ביטוי שלם בסוגריים.
    - [HIGH] E9 (one-new-thing): תרגיל 9 מציג שני רעיונות חדשים בו-זמנית: הוצאת גורם משותף שהוא ביטוי בסוגריים (שכבר הוצג בתרגיל 8) והתמודדות עם סימני מינוס המשפיעים על הביטוי שבתוך הסוגריים.
    - [MEDIUM] E10 (visual-scaffold): תרגיל 10, המיועד לסינתזה ויישום של כל הרעיונות שנלמדו, אינו כולל ייצוג חזותי ספציפי.
- **Artifacts:**
  - Skeleton: `generated-skeletons/פירוק-לגורמים-הוצאת-גורם-משותף.json`
  - Lesson text: `generated-lessons/פירוק-לגורמים-הוצאת-גורם-משותף.txt`
  - Verdict trace: `generated-verdicts/פירוק-לגורמים-הוצאת-גורם-משותף.iter*.json`

### פירוק לגורמים: נוסחאות כפל מקוצר
- **Chapter:** משוואות ריבועיות
- **Prev / Next:** פירוק לגורמים: הוצאת גורם משותף → פתרון משוואה ריבועית על ידי פירוק
- **Outcome:** HALT in 3 iter, 276.0s
- **Writer:** ✅ parses
  - iter 1: CRIT:1 HIGH:1 MED:2 → patched [2,9]
  - iter 2: CRIT:0 HIGH:2 MED:2 → patched [2,8]
  - iter 3: CRIT:0 HIGH:3 MED:0 → no patches
  - **Residual notes for human reviewer:**
    - [HIGH] E2 (perceptual-opening): סעיף ד' בתרגיל 2 דורש הצגת דוגמה מספרית וחישוב, מה שמנוגד לעקרון הפתיחה התפיסתית של תרגילים 1-2 שאמורים להיות אינטואיטיביים בלבד וללא שימוש בערכים מספריים.
    - [HIGH] E4 (sequential-buildup): תרגיל 4 מציג רעיון חדש לחלוטין (ריבוע של סכום) ללא בנייה ישירה על התוכן האלגברי של תרגיל 3 (הפרש ריבועים), ובכך יוצר קפיצה מושגית.
    - [HIGH] E6 (sequential-buildup): תרגיל 6 מציג רעיון חדש לחלוטין (ריבוע של הפרש) ללא בנייה ישירה על התוכן האלגברי של תרגיל 5 (ריבוע של סכום), ובכך יוצר קפיצה מושגית.
- **Artifacts:**
  - Skeleton: `generated-skeletons/פירוק-לגורמים-נוסחאות-כפל-מקוצר.json`
  - Lesson text: `generated-lessons/פירוק-לגורמים-נוסחאות-כפל-מקוצר.txt`
  - Verdict trace: `generated-verdicts/פירוק-לגורמים-נוסחאות-כפל-מקוצר.iter*.json`

### פתרון משוואה ריבועית על ידי פירוק
- **Chapter:** משוואות ריבועיות
- **Prev / Next:** פירוק לגורמים: נוסחאות כפל מקוצר → (none)
- **Outcome:** PASS_WITH_NOTES in 2 iter, 247.1s
- **Writer:** ✅ parses
  - iter 1: CRIT:2 HIGH:4 MED:1 → patched [1,2,3,9,10]
  - iter 2: CRIT:0 HIGH:1 MED:1 → no patches
  - **Residual notes for human reviewer:**
    - [HIGH] E10 (one-new-thing): תרגיל 10 מציג בו-זמנית שלושה שלבים חדשים או מורכבים: פתיחת סוגריים (רעיון חדש שלא הוצג קודם כ'רעיון חדש'), סידור המשוואה (רעיון מתרגיל 8), ופירוק לגורמים (רעיון מתרגילים 4-7), במקום להציג רעיון חדש אחד בלבד.
    - [MEDIUM] E10 (sequential-buildup): הקפיצה המושגית בתרגיל 10, הכוללת פתיחת סוגריים כשלב מקדים חדש, עלולה להיות גדולה מדי ביחס לתרגיל הקודם, המשלב רק שני סוגי פירוק.
- **Artifacts:**
  - Skeleton: `generated-skeletons/פתרון-משוואה-ריבועית-על-ידי-פירוק.json`
  - Lesson text: `generated-lessons/פתרון-משוואה-ריבועית-על-ידי-פירוק.txt`
  - Verdict trace: `generated-verdicts/פתרון-משוואה-ריבועית-על-ידי-פירוק.iter*.json`

### משפט פיתגורס: יישומים
- **Chapter:** גיאומטריה
- **Prev / Next:** (none) → משולשים חופפים
- **Outcome:** PASS_CLEAN in 1 iter, 132.3s
- **Writer:** ✅ parses
  - iter 1: CRIT:0 HIGH:0 MED:0 → no patches
  - **Residual notes for human reviewer:**
    - [LOW] lesson-level (other): ההצהרה 'ידע קודם: (אין)' אינה מדויקת עבור שיעור בכיתה י', שכן תלמידים ברמה זו צפויים להחזיק בידע גיאומטרי בסיסי.
- **Artifacts:**
  - Skeleton: `generated-skeletons/משפט-פיתגורס-יישומים.json`
  - Lesson text: `generated-lessons/משפט-פיתגורס-יישומים.txt`
  - Verdict trace: `generated-verdicts/משפט-פיתגורס-יישומים.iter*.json`

### משולשים חופפים
- **Chapter:** גיאומטריה
- **Prev / Next:** משפט פיתגורס: יישומים → משולשים דומים
- **Outcome:** PASS_CLEAN in 3 iter, 239.0s
- **Writer:** ✅ parses
  - iter 1: CRIT:1 HIGH:0 MED:2 → patched [2]
  - iter 2: CRIT:0 HIGH:2 MED:1 → patched [8,9]
  - iter 3: CRIT:0 HIGH:0 MED:0 → no patches
- **Artifacts:**
  - Skeleton: `generated-skeletons/משולשים-חופפים.json`
  - Lesson text: `generated-lessons/משולשים-חופפים.txt`
  - Verdict trace: `generated-verdicts/משולשים-חופפים.iter*.json`

### משולשים דומים
- **Chapter:** גיאומטריה
- **Prev / Next:** משולשים חופפים → (none)
- **Outcome:** HALT in 3 iter, 201.3s
- **Writer:** ✅ parses
  - iter 1: CRIT:1 HIGH:1 MED:0 → patched [2,4]
  - iter 2: CRIT:0 HIGH:3 MED:0 → patched [5,7,8]
  - iter 3: CRIT:0 HIGH:2 MED:0 → no patches
  - **Residual notes for human reviewer:**
    - [HIGH] E3 (sequential-buildup): תרגיל 3 מציג חישובים מספריים של יחסי צלעות מיד לאחר תרגיל 2 שהתמקד בזיהוי ויזואלי של זוויות שוות ללא חישובים, ויוצר קפיצה מושגית.
    - [HIGH] E7 (sequential-buildup): תרגיל 7 מציג את משפט הדמיון צ.צ.צ באופן פתאומי, ללא מעבר הדרגתי מתרגיל 6 שעסק ביישום משפט ז.ז.
- **Artifacts:**
  - Skeleton: `generated-skeletons/משולשים-דומים.json`
  - Lesson text: `generated-lessons/משולשים-דומים.txt`
  - Verdict trace: `generated-verdicts/משולשים-דומים.iter*.json`

### הגדרת סינוס, קוסינוס וטנגנס
- **Chapter:** טריגונומטריה במשולש ישר-זווית
- **Prev / Next:** משולשים דומים → חישוב צלעות במשולש ישר-זווית
- **Outcome:** PASS_CLEAN in 2 iter, 174.9s
- **Writer:** ✅ parses
  - iter 1: CRIT:1 HIGH:2 MED:0 → patched [2,8]
  - iter 2: CRIT:0 HIGH:0 MED:1 → no patches
  - **Residual notes for human reviewer:**
    - [MEDIUM] E2 (one-new-thing): תרגיל 2 חוזר על הרעיון של קביעות יחסי צלעות במשולשים דומים שהוצג בתרגיל 1, במקום להוסיף מרכיב חדש וייחודי.
- **Artifacts:**
  - Skeleton: `generated-skeletons/הגדרת-סינוס-קוסינוס-וטנגנס.json`
  - Lesson text: `generated-lessons/הגדרת-סינוס-קוסינוס-וטנגנס.txt`
  - Verdict trace: `generated-verdicts/הגדרת-סינוס-קוסינוס-וטנגנס.iter*.json`

### חישוב צלעות במשולש ישר-זווית
- **Chapter:** טריגונומטריה במשולש ישר-זווית
- **Prev / Next:** הגדרת סינוס, קוסינוס וטנגנס → חישוב זוויות במשולש ישר-זווית
- **Outcome:** PASS_WITH_NOTES in 3 iter, 277.2s
- **Writer:** ✅ parses
  - iter 1: CRIT:2 HIGH:1 MED:1 → patched [2,8]
  - iter 2: CRIT:0 HIGH:2 MED:1 → patched [2]
  - iter 3: CRIT:0 HIGH:1 MED:0 → no patches
  - **Residual notes for human reviewer:**
    - [HIGH] E4 (one-new-thing): ה-oneNewThing של תרגיל 4, 'יישום פונקציית הסינוס לחישוב הניצב שמול הזווית באופן שיטתי', אינו מהווה רכיב קונספטואלי חדש, שכן תהליך בניית המשוואה וחישוב צלע באמצעות סינוס כבר הוצג ותרגל במלואו בתרגיל 3.
- **Artifacts:**
  - Skeleton: `generated-skeletons/חישוב-צלעות-במשולש-ישר-זווית.json`
  - Lesson text: `generated-lessons/חישוב-צלעות-במשולש-ישר-זווית.txt`
  - Verdict trace: `generated-verdicts/חישוב-צלעות-במשולש-ישר-זווית.iter*.json`

### חישוב זוויות במשולש ישר-זווית
- **Chapter:** טריגונומטריה במשולש ישר-זווית
- **Prev / Next:** חישוב צלעות במשולש ישר-זווית → (none)
- **Outcome:** PASS_CLEAN in 3 iter, 245.7s
- **Writer:** ✅ parses
  - iter 1: CRIT:1 HIGH:0 MED:0 → patched [2]
  - iter 2: CRIT:1 HIGH:0 MED:0 → patched [2]
  - iter 3: CRIT:0 HIGH:0 MED:0 → no patches
- **Artifacts:**
  - Skeleton: `generated-skeletons/חישוב-זוויות-במשולש-ישר-זווית.json`
  - Lesson text: `generated-lessons/חישוב-זוויות-במשולש-ישר-זווית.txt`
  - Verdict trace: `generated-verdicts/חישוב-זוויות-במשולש-ישר-זווית.iter*.json`
