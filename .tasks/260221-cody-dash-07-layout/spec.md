# TASK-07: Cody Route Group Layout & Page

## Summary
Create the (cody) route group with its own HTML layout, Tailwind CSS, CopilotKit provider, and auth-gated page.

## Task Type
implement_feature

## Dependencies
- TASK-01 (spike result — determines Gemini vs OpenAI adapter)

## Requirements

### R1: Create (cody) layout
- File: `src/app/(cody)/layout.tsx`
- Server component (default)
- Own `<html>` and `<body>` tags (required — no shared root layout)
- Import Tailwind CSS: `import '@/app/(frontend)/globals.css'` (reuse existing)
- Import Geist fonts (same pattern as frontend layout but simplified)
- No i18n, no locale — English only
- No Header/Footer — clean dashboard layout
- Metadata: `title: 'Cody Dashboard'`

### R2: Create page with auth gate
- File: `src/app/(cody)/cody/page.tsx`
- Client component (`'use client'`)
- Use `useCurrentUser()` hook from `@/client/hooks/useCurrentUser`
- Loading state: show Spinner while checking auth
- Not authenticated: redirect to `/admin/login` (use `window.location.href`)
- Not admin (`!user.roles?.includes('admin')`): show "Access Denied" message
- Authenticated admin: render `<CopilotKit runtimeUrl="/api/copilotkit">` wrapper around `<CodyDashboard />`

### R3: CodyDashboard shell
- File: `src/ui/admin/CodyDashboard/index.tsx`
- Client component
- For now: placeholder that says "Cody Operations Dashboard" with a heading
- Will be filled in by TASK-08 (kanban board)

### R4: Update from spike
- If TASK-01 created spike files at these paths, upgrade them
- If TASK-01 used different paths, move files to correct locations
- Remove any spike-only test code (like the getCurrentTime action)

## Files to Create/Modify
- `src/app/(cody)/layout.tsx` (NEW or MODIFIED from spike)
- `src/app/(cody)/cody/page.tsx` (NEW or MODIFIED from spike)
- `src/ui/admin/CodyDashboard/index.tsx` (NEW)

## Acceptance Criteria
- [ ] `/cody` loads in the browser
- [ ] Unauthenticated users are redirected to `/admin/login`
- [ ] Non-admin users see "Access Denied"
- [ ] Admin users see the CodyDashboard placeholder
- [ ] Page has its own `<html>` tags (not nested in frontend layout)
- [ ] Tailwind classes work
- [ ] `pnpm tsc --noEmit` passes

## Notes
- Reference `src/app/(frontend)/layout.tsx` for the layout pattern but keep it much simpler
- `useCurrentUser()` fetches from `/api/users/me` with cookies — works from any route group
- The CopilotKit provider wraps the entire dashboard so chat can access actions from any component
