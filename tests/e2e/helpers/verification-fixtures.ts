/**
 * Shared Playwright fixtures for pre-launch verification tests.
 * Provides pre-authenticated pages and seeded test data.
 */
import { test as base } from '@playwright/test'

import type { TestCourseData } from './courses'
import type { TestExerciseData } from './admin'
import { generateTestUserEmail, setupAuthenticatedUser, cleanupTestUsers } from './auth'
import { seedTestCourseData, buildLessonUrl } from './courses'
import { seedTestExercises, cleanupTestExercises } from './admin'

export interface VerificationData {
  course: TestCourseData
  exercises: TestExerciseData[]
  lessonUrl: string
}

// Shared state across all verification tests (set once in beforeAll)
let sharedData: VerificationData | null = null

export async function getOrSeedData(): Promise<VerificationData | null> {
  if (sharedData) return sharedData

  const course = await seedTestCourseData()
  if (!course) return null

  const exercises = await seedTestExercises(course)
  const lessonUrl = buildLessonUrl(course)

  sharedData = { course, exercises, lessonUrl }
  return sharedData
}

export async function cleanupVerificationData(): Promise<void> {
  await cleanupTestExercises()
  await cleanupTestUsers()
  sharedData = null
}

/**
 * Extended test fixture with authenticated student page.
 */
export const studentTest = base.extend<{ studentPage: typeof base }>({})

/**
 * Helper: set up an authenticated student on a page.
 */
export async function loginAsStudent(page: import('@playwright/test').Page) {
  return setupAuthenticatedUser(
    page,
    {
      email: generateTestUserEmail('verify-student'),
      password: 'TestPass123!',
    },
    'student',
  )
}

/**
 * Helper: set up an authenticated admin on a page.
 */
export async function loginAsAdmin(page: import('@playwright/test').Page) {
  return setupAuthenticatedUser(
    page,
    {
      email: generateTestUserEmail('verify-admin'),
      password: 'AdminPass123!',
    },
    'admin',
  )
}
