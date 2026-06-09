# Application Routes

**@domain** app
**@fileType** routes
**@ai-summary** Next.js App Router host for Payload admin and server APIs.

---

## Structure

```
app/
├── (payload)/              # Payload CMS routes
│   ├── admin/              # Admin panel
│   └── api/                # Payload REST and GraphQL routes
└── api/                    # Custom API routes used by admin, jobs, webhooks, and services
```

## Key Files

- `(payload)/layout.tsx` - Payload admin root layout
- `(payload)/admin/` - Payload admin panel routes
- `(payload)/api/[...slug]/route.ts` - Payload REST API
- [`api/health/route.ts`](./api/health/route.ts) - Health endpoint

## Related

- [`src/ui/admin/`](../ui/admin/README.md) - Admin UI components
- [`src/ui/shared/`](../ui/shared/README.md) - Shared admin/Payload renderers
- [`src/server/`](../server/README.md) - Server configuration
