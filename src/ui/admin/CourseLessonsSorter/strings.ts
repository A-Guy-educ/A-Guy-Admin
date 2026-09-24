/**
 * Localized strings for the CourseLessonsSorter component.
 *
 * Admin panel supports English + Hebrew. Selection happens at runtime via
 * `useTranslation().i18n.language` from @payloadcms/ui (see `useStrings`).
 */

interface Strings {
  courseLessons: string
  chapter: string
  lesson: string
  learning: string
  practice: string
  exam: string
  filterAll: string
  loading: string
  noLessons: string
  moveUp: string
  moveDown: string
  failedToLoad: string
  failedToReorder: string
  draft: string
  published: string
  archived: string
  exercises: string
  reviewDotTitle: string
  failedToUpdateReview: string
}

const EN: Strings = {
  courseLessons: 'Course Lessons',
  chapter: 'Chapter',
  lesson: 'Lesson',
  learning: 'Learning',
  practice: 'Practice',
  exam: 'Exam',
  filterAll: 'All',
  loading: 'Loading lessons...',
  noLessons: 'No lessons yet.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  failedToLoad: 'Failed to load lessons',
  failedToReorder: 'Failed to reorder lesson',
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
  exercises: 'exercises',
  reviewDotTitle: 'Click to cycle review status (red → orange → green)',
  failedToUpdateReview: 'Failed to update review status',
}

const HE: Strings = {
  courseLessons: 'שיעורי הקורס',
  chapter: 'פרק',
  lesson: 'שיעור',
  learning: 'למידה',
  practice: 'תרגול',
  exam: 'מבחן',
  filterAll: 'הכל',
  loading: 'טוען שיעורים...',
  noLessons: 'אין שיעורים עדיין.',
  moveUp: 'העלה',
  moveDown: 'הורד',
  failedToLoad: 'טעינת השיעורים נכשלה',
  failedToReorder: 'שינוי הסדר נכשל',
  draft: 'טיוטה',
  published: 'פורסם',
  archived: 'בארכיון',
  exercises: 'תרגילים',
  reviewDotTitle: 'לחיצה מחליפה סטטוס ביקורת (אדום → כתום → ירוק)',
  failedToUpdateReview: 'עדכון סטטוס הביקורת נכשל',
}

export function getStrings(lang: string): Strings {
  return lang.toLowerCase().startsWith('he') ? HE : EN
}
