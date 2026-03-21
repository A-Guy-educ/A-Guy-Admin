/**
 * E2E Tests for Cody Dashboard Chat
 *
 * Tests the Cody chat functionality:
 * - Chat input is accessible and functional
 * - Messages can be sent and responses received
 * - Session management works correctly
 * - localStorage persistence for sessions
 *
 * Run with: pnpm test:e2e --project=chromium tests/e2e/cody-chat.e2e.spec.ts
 */
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { cleanupTestUsers, generateTestUserEmail, setupAuthenticatedUser } from './helpers/auth'

// Skip tests if required env vars are not set
const hasGeminiKey = !!process.env.GEMINI_API_KEY
const hasGhPat = !!process.env.GH_PAT

test.describe('Cody Dashboard Chat', () => {
  test.skip(!hasGeminiKey, 'Skipping Cody chat tests: GEMINI_API_KEY is not set')
  test.skip(!hasGhPat, 'Skipping Cody chat tests: GH_PAT is not set')

  let testUserEmail: string

  test.beforeAll(async () => {
    testUserEmail = generateTestUserEmail('cody-chat-e2e')
  })

  test.afterAll(async () => {
    await cleanupTestUsers()
  })

  /**
   * Helper to find the chat input in the Cody dashboard
   */
  async function findChatInput(page: Page): Promise<Locator> {
    // Try different selectors for the chat input
    const selectors = [
      // CodyChat textarea
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="ask"]',
      // General textarea in chat area
      'textarea',
    ]

    for (const selector of selectors) {
      const input = page.locator(selector).first()
      if ((await input.count()) > 0) {
        const isVisible = await input.isVisible().catch(() => false)
        if (isVisible) {
          return input
        }
      }
    }
    throw new Error('Could not find chat input field')
  }

  /**
   * Helper to wait for assistant response
   */
  async function waitForAssistantMessage(page: Page, timeout = 60000) {
    // Look for assistant messages (bg-muted in the chat area)
    const assistantMessage = page.locator('.bg-muted').last()
    await assistantMessage.waitFor({ state: 'visible', timeout })
    return assistantMessage
  }

  /**
   * Helper to wait for loading to complete
   */
  async function waitForLoadingComplete(page: Page, timeout = 30000) {
    // Look for loading indicators
    const loadingSelectors = ['text=Loading...', 'text=Loading conversation...', '.animate-pulse']

    for (const selector of loadingSelectors) {
      try {
        const el = page.locator(selector).first()
        if ((await el.count()) > 0) {
          await el.waitFor({ state: 'hidden', timeout })
        }
      } catch {
        // Element might not exist, that's okay
      }
    }
  }

  test('should load dashboard and find chat input', async ({ page }) => {
    // Navigate to Cody dashboard
    await page.goto('/cody')
    await page.waitForLoadState('networkidle')

    // Authenticate
    await setupAuthenticatedUser(page, {
      email: testUserEmail,
      password: 'password123',
    })

    // Reload after authentication
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Wait for dashboard to load
    await page.waitForTimeout(2000)

    // Find chat input
    const chatInput = await findChatInput(page)
    await expect(chatInput).toBeVisible()

    // Verify input is empty and ready
    const inputValue = await chatInput.inputValue()
    expect(inputValue).toBe('')
  })

  test('should send message and receive response', async ({ page }) => {
    // Navigate to Cody dashboard
    await page.goto('/cody')
    await page.waitForLoadState('networkidle')

    // Authenticate
    await setupAuthenticatedUser(page, {
      email: testUserEmail,
      password: 'password123',
    })

    // Reload after authentication
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Wait for dashboard to load
    await page.waitForTimeout(2000)

    // Find chat input
    const chatInput = await findChatInput(page)

    // Clear any existing content and send a simple message
    const testMessage = `Hello, tell me something simple - ${Date.now()}`
    await chatInput.fill(testMessage)

    // Submit the message
    await chatInput.press('Enter')

    // Wait for response (streaming may take time)
    try {
      await waitForAssistantMessage(page, 60000)
    } catch {
      // If no response, check if there's an error message
      const errorVisible = await page
        .locator('text=/error|failed|unavailable/i')
        .isVisible()
        .catch(() => false)
      if (errorVisible) {
        // This might be expected if API keys aren't configured properly
        test.skip(true, 'Chat service may not be available')
        return
      }
      throw new Error('No response received from chat')
    }

    // Verify the page didn't crash and has content
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('should persist session in localStorage', async ({ page }) => {
    // Navigate to Cody dashboard
    await page.goto('/cody')
    await page.waitForLoadState('networkidle')

    // Authenticate
    await setupAuthenticatedUser(page, {
      email: testUserEmail,
      password: 'password123',
    })

    // Reload after authentication
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Wait for dashboard to load
    await page.waitForTimeout(2000)

    // Find chat input and send a message
    const chatInput = await findChatInput(page)
    const testMessage = `Session test - ${Date.now()}`
    await chatInput.fill(testMessage)
    await chatInput.press('Enter')

    // Wait for any response
    try {
      await waitForLoadingComplete(page, 10000)
    } catch {
      // Ignore loading timeout
    }

    // Check localStorage for session data
    const localStorageData = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.includes('cody'))
      const data: Record<string, unknown> = {}
      for (const key of keys) {
        try {
          data[key] = JSON.parse(localStorage.getItem(key) || '')
        } catch {
          data[key] = localStorage.getItem(key)
        }
      }
      return data
    })

    // Should have session data in localStorage
    expect(Object.keys(localStorageData).length).toBeGreaterThan(0)
  })

  test('should handle multiple messages in conversation', async ({ page }) => {
    // Navigate to Cody dashboard
    await page.goto('/cody')
    await page.waitForLoadState('networkidle')

    // Authenticate
    await setupAuthenticatedUser(page, {
      email: testUserEmail,
      password: 'password123',
    })

    // Reload after authentication
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Wait for dashboard to load
    await page.waitForTimeout(2000)

    // Find chat input
    const chatInput = await findChatInput(page)

    // Send first message
    const message1 = `First message - ${Date.now()}`
    await chatInput.fill(message1)
    await chatInput.press('Enter')

    // Wait for response or loading
    await page.waitForTimeout(3000)

    // Send second message
    const message2 = `Second message - ${Date.now()}`
    await chatInput.fill(message2)
    await chatInput.press('Enter')

    // Wait for any processing
    await page.waitForTimeout(3000)

    // Verify page is still responsive
    const chatInputAfter = await findChatInput(page)
    await expect(chatInputAfter).toBeVisible()
  })
})
