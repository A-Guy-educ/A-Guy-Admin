/**
 * @fileType test
 * @domain frontend
 * @pattern lesson-navigation, url-routing
 * @ai-summary Verifies that lesson pages navigate to course page after completion, not chapter page
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('Lesson Navigation backUrl Fix (Issue #851)', () => {
  /**
   * This test verifies that the backUrl in lesson pages points to the course page
   * rather than the chapter page, ensuring users are redirected to the modern
   * course page after completing a lesson instead of the old chapter list view.
   */
  it('lesson page should navigate to course page (not chapter page)', () => {
    const lessonPagePath = path.join(
      process.cwd(),
      'src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/page.tsx',
    )
    const content = fs.readFileSync(lessonPagePath, 'utf-8')

    // The backUrl should point to /courses/${courseSlug} (course page - new UI)
    // NOT /courses/${courseSlug}/chapters/${chapterSlug} (chapter page - old UI)
    expect(content).toContain('const backUrl = `/courses/${courseSlug}`')
    expect(content).not.toContain(
      'const backUrl = `/courses/${courseSlug}/chapters/${chapterSlug}`',
    )
  })

  it('exercise page should navigate to course page (not lesson page)', () => {
    const exercisePagePath = path.join(
      process.cwd(),
      'src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/exercises/[exerciseSlug]/page.tsx',
    )
    const content = fs.readFileSync(exercisePagePath, 'utf-8')

    // The backUrl should point to /courses/${courseSlug} (course page)
    // NOT /courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug} (lesson page)
    expect(content).toContain('const backUrl = `/courses/${courseSlug}`')
    expect(content).not.toContain(
      'const backUrl = `/courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug}`',
    )
  })

  it('complete page should navigate to course page (not lesson page)', () => {
    const completePagePath = path.join(
      process.cwd(),
      'src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/complete/page.tsx',
    )
    const content = fs.readFileSync(completePagePath, 'utf-8')

    // The backUrl should point to /courses/${courseSlug} (course page)
    // NOT /courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug} (lesson page)
    expect(content).toContain('const backUrl = `/courses/${courseSlug}`')
    expect(content).not.toContain(
      'const backUrl = `/courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug}`',
    )
  })

  it('all three lesson navigation pages should use consistent course page URL', () => {
    const basePath =
      'src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]'

    const lessonPage = fs.readFileSync(path.join(process.cwd(), `${basePath}/page.tsx`), 'utf-8')
    const exercisePage = fs.readFileSync(
      path.join(process.cwd(), `${basePath}/exercises/[exerciseSlug]/page.tsx`),
      'utf-8',
    )
    const completePage = fs.readFileSync(
      path.join(process.cwd(), `${basePath}/complete/page.tsx`),
      'utf-8',
    )

    // All three should have consistent backUrl pointing to course page
    const courseUrlPattern = 'const backUrl = `/courses/${courseSlug}`'

    expect(lessonPage).toContain(courseUrlPattern)
    expect(exercisePage).toContain(courseUrlPattern)
    expect(completePage).toContain(courseUrlPattern)
  })
})
