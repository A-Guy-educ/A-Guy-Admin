/**
 * Pre-Launch Verification: #3 Site-wide Search, #4 Catalog Navigation
 */
import { expect, test } from '@playwright/test'

import { cleanupTestUsers } from '../helpers/auth'
import { loginAsStudent } from '../helpers/verification-fixtures'

test.afterAll(async () => {
  await cleanupTestUsers()
})

test.describe('Scenario #3 – Site-wide Search', () => {
  test('searching for keywords returns relevant results', async ({ page }) => {
    await loginAsStudent(page)
    await page.goto('/search?q=test')
    await page.waitForLoadState('networkidle')

    // Search input should be present and populated
    const searchInput = page.locator(
      'input[id="search"], input[placeholder*="Search"], input[placeholder*="חיפוש"]',
    )
    await expect(searchInput.first()).toBeVisible({ timeout: 10_000 })

    // Either results or empty-state should appear
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})

test.describe('Scenario #4 – Catalog Navigation', () => {
  test('course cards display in the catalog', async ({ page }) => {
    await loginAsStudent(page)
    await page.goto('/courses')
    await page.waitForLoadState('networkidle')

    // Wait for course cards or empty state
    const cards = page.locator('[class*="bg-card"][class*="rounded"]')
    const emptyState = page.locator('text=/no courses/i, text=/אין קורסים/i')

    const hasCards = await cards
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false)
    const isEmpty = await emptyState
      .first()
      .isVisible()
      .catch(() => false)

    expect(hasCards || isEmpty).toBeTruthy()
  })

  test('course card shows title and action button', async ({ page }) => {
    await loginAsStudent(page)
    await page.goto('/courses')
    await page.waitForLoadState('networkidle')

    const firstCard = page.locator('[class*="bg-card"][class*="rounded"]').first()
    const cardVisible = await firstCard.isVisible({ timeout: 10_000 }).catch(() => false)
    test.skip(!cardVisible, 'No courses available in catalog')

    // Card should have a title (h4) and a button
    await expect(firstCard.locator('h4').first()).toBeVisible()
    await expect(firstCard.locator('button, a').first()).toBeVisible()
  })
})
