
### taskify (2026-04-15T09:25:38)
## Summary

**Root Cause**: The security scanner's regex pattern `/withApiHandler\s*\(/` couldn't detect authentication when `withApiHandler` was used with TypeScript generics like `withApiHandler<T, U>({ auth: 'admin' })`. The `<T, U>` syntax caused the pattern to fail matching.

**Fix**: Updated the regex pattern in `scripts/inspector/plugins/project/security-scanner/rules.ts` from:
```javascript
/withApiHandler\s*\(/
```
to:
```javascript
/withApiHandler(?:\s*<[^>]+>)?\s*\(/
```

This now cor
...(truncated)

### plan (2026-04-15T09:26:00)
**Status: Complete**

The security scanner fix has been applied to `scripts/inspector/plugins/project/security-scanner/rules.ts`:

```diff
-  /withApiHandler\s*\(/,
+  /withApiHandler(?:\s*<[^>]+>)?\s*\(/, // Handles TypeScript generics: withApiHandler<T>()
```

**Verification results:**
- 5 falsely-flagged routes are no longer detected by the scanner
- Unit tests pass: 8/8

**Note:** The remaining 2 routes (`course-syllabus/route.ts`, `cron/warmup/route.ts`) that still appear as missing auth ar
...(truncated)

### build (2026-04-15T09:29:05)
## Verification Complete

The security scanner fix has been properly implemented. Here's the summary:

### Fix Applied
**File:** `scripts/inspector/plugins/project/security-scanner/rules.ts` (line 38)

```diff
-  /withApiHandler\s*\(/,
+  /withApiHandler(?:\s*<[^>]+>)?\s*\(/, // Handles TypeScript generics: withApiHandler<T>()
```

### Root Cause
The original regex `/withApiHandler\s*\(/` failed to match when `withApiHandler` was used with TypeScript generics like `withApiHandler<T, U>({ auth: '
...(truncated)
