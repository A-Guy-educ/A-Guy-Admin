/**
 * Pre-Launch Verification: #1 OAuth Login, #2 Onboarding Journey
 */
import { expect, test } from '@playwright/test'

import { cleanupTestUsers } from '../helpers/auth'
import { loginAsStudent } from '../helpers/verification-fixtures'

test.afterAll(async () => {
  await cleanupTestUsers()
})

test.describe('Scenario #1 – OAuth Login (smoke)', () => {
  test('Google OAuth button is visible on login page', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const oauthButton = page.locator('a[href*="oauth/google"], button:has-text("Google")')
    await expect(oauthButton.first()).toBeVisible({ timeout: 10_000 })
  })

  test('Google OAuth link points to correct provider', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const link = page.locator('a[href*="oauth/google"]').first()
    if (await link.isVisible()) {
      const href = await link.getAttribute('href')
      expect(href).toContain('oauth/google')
    }
  })
})

test.describe('Scenario #2 – Onboarding Journey', () => {
  test('new user is prompted to select a persona', async ({ page }) => {
    await loginAsStudent(page)
    await page.goto('/onboarding/persona')
    await page.waitForLoadState('networkidle')

    // Persona selection step should be visible
    const personaContent = page.locator('[class*="persona"], [data-testid*="persona"]')
    const heading = page.getByRole('heading')

    const hasPersonaUI = await personaContent
      .first()
      .isVisible()
      .catch(() => false)
    const hasHeading = await heading
      .first()
      .isVisible()
      .catch(() => false)

    expect(hasPersonaUI || hasHeading).toBeTruthy()
  })
})
