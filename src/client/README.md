# Client-Side Utilities

**@domain** client
**@fileType** utilities
**@ai-summary** Client-only code: hooks, state, API clients, utilities

---

## Structure

```
client/
├── hooks/       # React hooks (useDebounce)
```

## Patterns

| Pattern     | Location | Description                    |
| ----------- | -------- | ------------------------------ |
| client-hook | `hooks/` | Reusable React component logic |

## Key Files

- [`hooks/useDebounce.ts`](./hooks/useDebounce.ts) - Debounce value changes
- [`hooks/useCurrentUser.ts`](./hooks/useCurrentUser.ts) - Current Payload user lookup

## Common Tasks

| Task        | File            | Usage                                  |
| ----------- | --------------- | -------------------------------------- |
| Create hook | `hooks/name.ts` | `export const useName = () => { ... }` |

## Related

- [`src/ui/shared/`](../ui/shared/README.md) - Shared admin/Payload UI components
- [`src/ui/admin/`](../ui/admin/README.md) - Admin UI components
- [`src/infra/`](../infra/README.md) - Shared infrastructure
