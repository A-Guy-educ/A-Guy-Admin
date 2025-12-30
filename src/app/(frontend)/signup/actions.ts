'use server'

import { z } from 'zod'
import { getPayload } from 'payload'
import config from '@payload-config'
import { cookies } from 'next/headers'

// Rate limiting store (in-memory - use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

// Validation schema
const SignupSchema = z.object({
  name: z.string().min(1, 'Name is required').trim(),
  email: z.string().email('Invalid email format').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  // Honeypot field
  website: z.string().optional(),
})

interface SignupResult {
  success: boolean
  message?: string
  errors?: Record<string, string>
}

// Rate limiting helper
function checkRateLimit(identifier: string): boolean {
  const now = Date.now()
  const limit = rateLimitStore.get(identifier)

  if (!limit || now > limit.resetAt) {
    // Reset or create new limit
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + 15 * 60 * 1000, // 15 minutes
    })
    return true
  }

  if (limit.count >= 5) {
    // Exceeded limit: 5 attempts per 15 minutes
    return false
  }

  limit.count++
  return true
}

export async function signupAction(formData: FormData): Promise<SignupResult> {
  try {
    // 1. Extract data
    const rawData = {
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password'),
      confirmPassword: formData.get('confirmPassword'),
      website: formData.get('website'),
    }

    // 2. Honeypot check (anti-spam layer 1)
    if (rawData.website && rawData.website.toString().trim() !== '') {
      // Bot detected - reject silently with generic message
      return {
        success: false,
        message: 'Unable to create account. Please try again.',
      }
    }

    // 3. Validate with Zod
    const parsed = SignupSchema.safeParse(rawData)

    if (!parsed.success) {
      const errors: Record<string, string> = {}
      parsed.error.issues.forEach((err) => {
        if (err.path[0]) {
          errors[err.path[0].toString()] = err.message
        }
      })
      return {
        success: false,
        message: 'Validation failed',
        errors,
      }
    }

    const { name, email, password, confirmPassword } = parsed.data

    // 4. Check password match
    if (password !== confirmPassword) {
      return {
        success: false,
        errors: { confirmPassword: 'Passwords do not match' },
      }
    }

    // 5. Rate limiting (anti-spam layer 2)
    // Use email hash as identifier
    const emailHash = Buffer.from(email).toString('base64')
    if (!checkRateLimit(emailHash)) {
      return {
        success: false,
        message: 'Too many signup attempts. Please try again later.',
      }
    }

    // TODO: Add Cloudflare Turnstile verification here (anti-spam layer 3)
    // See tech-debt/1-turnstile-integration.md

    // 6. Create user via Payload
    const payload = await getPayload({ config })

    try {
      await payload.create({
        collection: 'users',
        data: {
          name,
          email,
          password,
          // Force role to 'student' - never trust client input for roles
          roles: ['student'],
        },
      })

      // 7. Auto-login: Set auth cookies
      const cookieStore = await cookies()
      const token = await payload.login({
        collection: 'users',
        data: {
          email,
          password,
        },
      })

      if (token && 'token' in token && token.token) {
        // Set the Payload auth cookie
        cookieStore.set('payload-token', token.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60, // 7 days
          path: '/',
        })
      }

      return {
        success: true,
        message: 'Account created successfully',
      }
    } catch (error) {
      // Check if it's a duplicate email error
      if (error && typeof error === 'object' && 'message' in error) {
        const errorMessage = error.message as string
        if (
          errorMessage.includes('duplicate') ||
          errorMessage.includes('unique') ||
          errorMessage.includes('E11000')
        ) {
          // Generic response - do NOT reveal email exists
          return {
            success: false,
            message: 'Unable to create account. Please try again.',
          }
        }
      }

      // Generic error for any other failure
      return {
        success: false,
        message: 'An error occurred during signup. Please try again.',
      }
    }
  } catch (_error) {
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again.',
    }
  }
}
