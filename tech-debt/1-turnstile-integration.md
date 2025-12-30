# Tech Debt: Cloudflare Turnstile Integration

**Priority**: Medium
**Status**: Pending
**Created**: 2025-12-30
**Related to**: Public signup anti-spam protection

## Context

The public signup page (`/signup`) currently implements two layers of bot protection:

1. ✅ Honeypot field (invisible field that bots fill)
2. ✅ Rate limiting (5 attempts per 15 minutes per email)
3. ⏳ **MISSING**: CAPTCHA verification (Cloudflare Turnstile)

## What Needs to Be Done

### 1. Get Cloudflare Turnstile Credentials

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to "Turnstile" section
3. Create a new site
4. Get **Site Key** and **Secret Key**

### 2. Add Environment Variables

Add to `.env`:

```env
# Cloudflare Turnstile (bot protection)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-site-key-here
TURNSTILE_SECRET_KEY=your-secret-key-here
```

Add to `.env.example`:

```env
# Cloudflare Turnstile (bot protection)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

### 3. Install Turnstile Package

```bash
pnpm add @marsidev/react-turnstile
```

### 4. Update Signup Form

**File**: `src/app/(frontend)/signup/SignupForm.tsx`

Add Turnstile widget:

```tsx
import { Turnstile } from '@marsidev/react-turnstile'

// In the form, add:
;<Turnstile
  siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
  onSuccess={(token) => setTurnstileToken(token)}
/>

// Add turnstileToken to form submission
```

### 5. Update Server Action

**File**: `src/app/(frontend)/signup/actions.ts`

Add verification (around line 67, before creating user):

```typescript
// Verify Turnstile token
const turnstileToken = formData.get('cf-turnstile-response')

if (!turnstileToken) {
  return {
    success: false,
    message: 'Please complete the CAPTCHA verification.',
  }
}

const turnstileResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    secret: process.env.TURNSTILE_SECRET_KEY,
    response: turnstileToken,
  }),
})

const turnstileResult = await turnstileResponse.json()

if (!turnstileResult.success) {
  return {
    success: false,
    message: 'CAPTCHA verification failed. Please try again.',
  }
}
```

## Verification Checklist

When implementing:

- [ ] Turnstile widget appears on signup form
- [ ] Form submission fails without completing CAPTCHA
- [ ] Server validates token before creating user
- [ ] Invalid/expired tokens are rejected
- [ ] Error messages are user-friendly

## Estimated Effort

**30-45 minutes**

## Dependencies

- Cloudflare account (free)
- `@marsidev/react-turnstile` package

## Notes

- Turnstile is privacy-friendly (no Google dependency)
- Free tier: 1 million challenges per month
- Invisible mode available for better UX
- Falls back to interactive challenge if suspicious

## References

- [Cloudflare Turnstile Docs](https://developers.cloudflare.com/turnstile/)
- [React Turnstile Package](https://github.com/marsidev/react-turnstile)
- Current implementation: `src/app/(frontend)/signup/actions.ts:67` (TODO comment)
