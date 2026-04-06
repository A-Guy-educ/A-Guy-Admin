
### build (2026-04-06T11:08:20)
## Fix Summary

**Problem**: In `system-events-subscriber.ts`, the `alias()` call during `REGISTRATION_COMPLETED` was missing the `anonymousId` parameter, preventing Mixpanel from properly merging anonymous session data with the identified user profile.

**Changes made to `src/infra/analytics/system-events-subscriber.ts`**:

1. **Added import** (line 12):
   ```typescript
   import { getOrCreateAnonymousId } from './utils/anonymous-id'
   ```

2. **Fixed alias call** (line 233):
   ```typescript
...(truncated)
