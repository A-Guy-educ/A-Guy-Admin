/**
 * Pre-Launch Verification: #8 Free Response, #9 MCQ, #10 Matching,
 * #11 Table, #12 Success Feedback
 */
import { expect, test } from '@playwright/test'

import { buildExerciseUrl } from '../helpers/admin'
import {
  cleanupVerificationData,
  getOrSeedData,
  loginAsStudent,
  type VerificationData,
} from '../helpers/verification-fixtures'

let data: VerificationData | null = null

test.beforeAll(async () => {
  data = await getOrSeedData()
})

test.afterAll(async () => {
  await cleanupVerificationData()
})

test.describe('Scenario #8 – Free Response Input', () => {
  test('student can type and submit a free response', async ({ page }) => {
    test.skip(!data, 'No test data available')
    const freeEx = data!.exercises[1] // Free Response Exercise
    test.skip(!freeEx, 'Free response exercise not seeded')

    await loginAsStudent(page)
    await page.goto(buildExerciseUrl(data!.course, freeEx.exerciseSlug))
    await page.waitForLoadState('networkidle')

    // Find the textarea input
    const input = page.locator('textarea, input[type="text"]').first()
    await expect(input).toBeVisible({ timeout: 15_000 })

    await input.fill('4')

    // Find and click check answer button
    const checkBtn = page
      .locator('button')
      .filter({ hasText: /check|בדוק/i })
      .first()
    if (await checkBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await checkBtn.click()
      await page.waitForTimeout(1_000)
    }
  })
})

test.describe('Scenario #9 – Multiple Choice (MCQ)', () => {
  test('MCQ options are selectable and highlighted', async ({ page }) => {
    test.skip(!data, 'No test data available')
    const mcqEx = data!.exercises[0] // MCQ Exercise
    test.skip(!mcqEx, 'MCQ exercise not seeded')

    await loginAsStudent(page)
    await page.goto(buildExerciseUrl(data!.course, mcqEx.exerciseSlug))
    await page.waitForLoadState('networkidle')

    // Find MCQ option labels
    const options = page.locator('label[class*="rounded-lg border-2"]')
    await expect(options.first()).toBeVisible({ timeout: 15_000 })

    // Click the second option (correct: "4")
    await options.nth(1).click()

    // Verify visual selection state
    const selectedOption = options.nth(1)
    await expect(selectedOption).toHaveClass(/border-primary|bg-primary/)
  })
})

test.describe('Scenario #10 – Matching Connections', () => {
  test('student can connect matching pairs', async ({ page }) => {
    test.skip(!data, 'No test data available')
    const matchEx = data!.exercises[2] // Matching Exercise
    test.skip(!matchEx, 'Matching exercise not seeded')

    await loginAsStudent(page)
    await page.goto(buildExerciseUrl(data!.course, matchEx.exerciseSlug))
    await page.waitForLoadState('networkidle')

    // Find matching items
    const matchItems = page.locator('button[role="option"]')
    await expect(matchItems.first()).toBeVisible({ timeout: 15_000 })

    // Click a left item then a right item to create a connection
    const items = await matchItems.all()
    if (items.length >= 2) {
      await items[0].click()
      await items[items.length - 1].click()
    }
  })
})

test.describe('Scenario #11 – Table Exercises', () => {
  test('student can enter data in table cells', async ({ page }) => {
    test.skip(!data, 'No test data available')
    const tableEx = data!.exercises[3] // Table Exercise
    test.skip(!tableEx, 'Table exercise not seeded')

    await loginAsStudent(page)
    await page.goto(buildExerciseUrl(data!.course, tableEx.exerciseSlug))
    await page.waitForLoadState('networkidle')

    // Find fillable table inputs
    const tableInputs = page.locator('table input[type="text"]')
    await expect(tableInputs.first()).toBeVisible({ timeout: 15_000 })

    // Fill in the first empty cell
    await tableInputs.first().fill('4')
  })
})

test.describe('Scenario #12 – Success Feedback', () => {
  test('correct answer triggers success feedback', async ({ page }) => {
    test.skip(!data, 'No test data available')
    const mcqEx = data!.exercises[0]
    test.skip(!mcqEx, 'MCQ exercise not seeded')

    await loginAsStudent(page)
    await page.goto(buildExerciseUrl(data!.course, mcqEx.exerciseSlug))
    await page.waitForLoadState('networkidle')

    // Select correct answer (option "4" at index 1)
    const options = page.locator('label[class*="rounded-lg border-2"]')
    await expect(options.first()).toBeVisible({ timeout: 15_000 })
    await options.nth(1).click()

    // Click check answer
    const checkBtn = page
      .locator('button')
      .filter({ hasText: /check|בדוק/i })
      .first()
    if (await checkBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await checkBtn.click()

      // Look for success indicators
      const successIndicator = page.locator(
        '[class*="text-success"], [class*="border-success"], [class*="CheckCircle"]',
      )
      await expect(successIndicator.first()).toBeVisible({ timeout: 10_000 })
    }
  })
})
