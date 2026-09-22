/**
 * Input shape for the planner (and eventually the CSV row schema).
 * Matches the plan file's "Input CSV" section — one row = one lesson to
 * generate.
 */
export interface GenerationInput {
  course: string
  chapter: string
  lessonName: string
  /** Empty string when this is the first lesson in the chapter. */
  prevLesson: string
  /** Empty string when this is the last lesson in the chapter. */
  nextLesson: string
  /** Free text — grade level as displayed, e.g. "7", "כיתה ז׳". Optional. */
  gradeLevel?: string
  /** Free-form guidance appended to the planner's user prompt. */
  notes?: string
}
