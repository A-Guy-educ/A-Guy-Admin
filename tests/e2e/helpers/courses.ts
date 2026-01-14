/**
 * Test helpers for course and lesson data
 */
import { getPayload } from 'payload'
import config from '@payload-config'

export interface TestCourseData {
  courseSlug: string
  chapterSlug: string
  lessonSlug: string
  courseId: string
  chapterId: string
  lessonId: string
}

/**
 * Get the first available published course with chapters and lessons
 * Returns null if no suitable course data is available
 */
export async function getTestCourseData(): Promise<TestCourseData | null> {
  try {
    const payload = await getPayload({ config })

    // Get first published course
    const courses = await payload.find({
      collection: 'courses',
      where: {
        and: [
          {
            status: {
              equals: 'published',
            },
          },
          {
            isActive: {
              equals: true,
            },
          },
        ],
      },
      limit: 1,
      depth: 2,
    })

    if (courses.docs.length === 0) {
      console.warn('No published courses found in database')
      return null
    }

    const course = courses.docs[0]

    // Get first chapter
    const chapters = await payload.find({
      collection: 'chapters',
      where: {
        and: [
          {
            course: {
              equals: course.id,
            },
          },
          {
            status: {
              equals: 'published',
            },
          },
          {
            isActive: {
              equals: true,
            },
          },
        ],
      },
      limit: 1,
      depth: 1,
    })

    if (chapters.docs.length === 0) {
      console.warn(`No published chapters found for course: ${course.slug}`)
      return null
    }

    const chapter = chapters.docs[0]

    // Get first lesson
    const lessons = await payload.find({
      collection: 'lessons',
      where: {
        and: [
          {
            chapter: {
              equals: chapter.id,
            },
          },
          {
            status: {
              equals: 'published',
            },
          },
          {
            isActive: {
              equals: true,
            },
          },
        ],
      },
      limit: 1,
      depth: 1,
    })

    if (lessons.docs.length === 0) {
      console.warn(`No published lessons found for chapter: ${chapter.slug}`)
      return null
    }

    const lesson = lessons.docs[0]

    // Validate slugs exist (required fields but TypeScript doesn't know)
    if (!course.slug || !chapter.slug || !lesson.slug) {
      throw new Error('Course, chapter, or lesson missing slug field')
    }

    return {
      courseSlug: course.slug,
      chapterSlug: chapter.slug,
      lessonSlug: lesson.slug,
      courseId: course.id,
      chapterId: chapter.id,
      lessonId: lesson.id,
    }
  } catch (error) {
    console.error('Error fetching test course data:', error)
    return null
  }
}

/**
 * Build lesson URL from course data
 */
export function buildLessonUrl(data: TestCourseData): string {
  return `/courses/${data.courseSlug}/chapters/${data.chapterSlug}/lessons/${data.lessonSlug}`
}
