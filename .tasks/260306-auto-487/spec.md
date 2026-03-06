# Specification: ExerciseAssets Access Control Fix

## Overview

Fix a security vulnerability in the `ExerciseAssets` collection where any authenticated user can delete or update any asset in the system, including assets belonging to other users or admin-uploaded content.

## Requirements

### FR-1: Restrict Delete Access
- Only admin users should be able to delete exercise assets
- Change access control from `authenticated` to `adminOnly`

### FR-2: Restrict Update Access
- Only admin users should be able to update exercise assets
- Change access control from `authenticated` to `adminOnly`

### FR-3: Preserve Create Access
- Keep `authenticated` for create operation (users can create assets via conversion pipeline)

### FR-4: Maintain Read Access
- Keep `anyone` for read operation (assets are publicly accessible)

## Acceptance Criteria

- [ ] `ExerciseAssets.delete` access is set to `adminOnly`
- [ ] `ExerciseAssets.update` access is set to `adminOnly`
- [ ] `ExerciseAssets.create` remains `authenticated`
- [ ] `ExerciseAssets.read` remains `anyone`
- [ ] Conversion pipeline still works (uses `overrideAccess: true` internally)
- [ ] Non-admin authenticated users receive 403 Forbidden when attempting to delete/update assets

## Comparison

**Current (Insecure):**
```typescript
access: {
  create: authenticated,
  delete: authenticated,
  update: authenticated,
  read: anyone,
}
```

**Expected (Secure):**
```typescript
access: {
  create: authenticated,
  delete: adminOnly,
  update: adminOnly,
  read: anyone,
}
```

## Reference Pattern

The `ChatAssets` collection already implements this secure pattern with `() => false` for delete/update, making them server-only operations.
