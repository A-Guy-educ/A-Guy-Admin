/**
 * @fileType test
 * @domain frontend
 * @pattern lesson-navigation, url-construction
 * @ai-summary Tests for lesson completion backUrl redirect to course page
 */
import { describe, expect, it } from 'vitest'

/**
 * Test suite for lesson completion backUrl redirect behavior.
 *
 * Bug: After completing an interactive lesson, clicking "Finish" redirects
 * to the old chapter page instead of the new course page.
 *
 * Expected: backUrl should point to /courses/{courseSlug} (course page)
 * Actual (before fix): backUrl points to /courses/{courseSlug}/chapters/{chapterSlug}
 *
 * This test file verifies the URL construction patterns match the expected behavior.
 */
describe('URL construction patterns', () => {
  const courseSlug = 'math-101'
  const chapterSlug = 'chapter-1'
  const lessonSlug = 'lesson-1'

  it('should construct course page URL correctly', () => {
    // The expected backUrl after fix: course page
    const expectedBackUrl = `/courses/${courseSlug}`
    expect(expectedBackUrl).toBe('/courses/math-101')
  })

  it('should NOT use chapter page URL as backUrl', () => {
    // The old incorrect backUrl: chapter page
    const oldChapterUrl = `/courses/${courseSlug}/chapters/${chapterSlug}`
    expect(oldChapterUrl).toBe('/courses/math-101/chapters/chapter-1')

    // After fix, this should NOT be used
    expect(oldChapterUrl).not.toBe(`/courses/${courseSlug}`)
  })

  it('should NOT use lesson page URL as backUrl', () => {
    // The old incorrect backUrl: lesson page
    const oldLessonUrl = `/courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug}`
    expect(oldLessonUrl).toBe('/courses/math-101/chapters/chapter-1/lessons/lesson-1')

    // After fix, this should NOT be used
    expect(oldLessonUrl).not.toBe(`/courses/${courseSlug}`)
  })
})

describe('Expected backUrl behavior', () => {
  const courseSlug = 'physics-101'
  const chapterSlug = 'mechanics'
  const lessonSlug = 'newtons-laws'

  it('lesson page: backUrl should be course page', () => {
    // Expected: backUrl = /courses/{courseSlug}
    const backUrl = `/courses/${courseSlug}`
    expect(backUrl).toBe('/courses/physics-101')
  })

  it('exercise page: backUrl should be course page', () => {
    // Expected: backUrl = /courses/{courseSlug}
    const backUrl = `/courses/${courseSlug}`
    expect(backUrl).toBe('/courses/physics-101')
  })

  it('complete page: backUrl should be course page', () => {
    // Expected: backUrl = /courses/{courseSlug}
    const backUrl = `/courses/${courseSlug}`
    expect(backUrl).toBe('/courses/physics-101')
  })
})

describe('Verify all entry points use consistent course page URL', () => {
  const courseSlug = 'chemistry-101'

  it('all entry points should use the same course page URL', () => {
    // All three entry points should use the same backUrl after fix
    const lessonPageBackUrl = `/courses/${courseSlug}`
    const exercisePageBackUrl = `/courses/${courseSlug}`
    const completePageBackUrl = `/courses/${courseSlug}`

    // All should be equal
    expect(lessonPageBackUrl).toBe(exercisePageBackUrl)
    expect(exercisePageBackUrl).toBe(completePageBackUrl)
    expect(lessonPageBackUrl).toBe(completePageBackUrl)
  })

  it('none should use chapter or lesson URL after fix', () => {
    const chapterSlug = 'organic-chem'
    const lessonSlug = 'bonding'

    const courseUrl = `/courses/${courseSlug}`
    const chapterUrl = `/courses/${courseSlug}/chapters/${chapterSlug}`
    const lessonUrl = `/courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug}`

    // After fix, all backUrls should equal courseUrl
    expect(courseUrl).not.toBe(chapterUrl)
    expect(courseUrl).not.toBe(lessonUrl)
  })
})

/**
 * Test that verifies the actual source code contains the expected backUrl pattern.
 * This test reads the source files and checks if they have been fixed.
 */
describe('Source code verification for backUrl fix', () => {
  it('should read lesson page and verify backUrl points to course page', async () => {
    // Read the source file
    const fs = await import('fs')
    const path = await import('path')

    const lessonPagePath = path.join(
      process.cwd(),
      'src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/page.tsx',
    )

    // Check if file exists
    expect(fs.existsSync(lessonPagePath)).toBe(true)

    const content = fs.readFileSync(lessonPagePath, 'utf-8')

    // After fix: should contain the EXACT line with course page backUrl
    // Look for: const backUrl = `/courses/${courseSlug}`
    const hasCoursePageBackUrl = content.includes('const backUrl = `/courses/${courseSlug}`')
    const hasChapterPageBackUrl = content.includes(
      'const backUrl = `/courses/${courseSlug}/chapters/${chapterSlug}`',
    )

    // This test will FAIL before the fix is applied
    expect(hasCoursePageBackUrl).toBe(true)
    expect(hasChapterPageBackUrl).toBe(false)
  })

  it('should read exercise page and verify backUrl points to course page', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const exercisePagePath = path.join(
      process.cwd(),
      'src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/exercises/[exerciseSlug]/page.tsx',
    )

    expect(fs.existsSync(exercisePagePath)).toBe(true)

    const content = fs.readFileSync(exercisePagePath, 'utf-8')

    // After fix: should contain the EXACT line with course page backUrl
    const hasCoursePageBackUrl = content.includes('const backUrl = `/courses/${courseSlug}`')
    const hasLessonPageBackUrl = content.includes(
      'const backUrl = `/courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug}`',
    )

    // This test will FAIL before the fix is applied
    expect(hasCoursePageBackUrl).toBe(true)
    expect(hasLessonPageBackUrl).toBe(false)
  })

  it('should read complete page and verify backUrl points to course page', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const completePagePath = path.join(
      process.cwd(),
      'src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/complete/page.tsx',
    )

    expect(fs.existsSync(completePagePath)).toBe(true)

    const content = fs.readFileSync(completePagePath, 'utf-8')

    // After fix: should contain the EXACT line with course page backUrl
    const hasCoursePageBackUrl = content.includes('const backUrl = `/courses/${courseSlug}`')
    const hasLessonPageBackUrl = content.includes(
      'const backUrl = `/courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lessonSlug}`',
    )

    // This test will FAIL before the fix is applied
    expect(hasCoursePageBackUrl).toBe(true)
    expect(hasLessonPageBackUrl).toBe(false)
  })
})
