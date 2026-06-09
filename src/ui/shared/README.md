# Shared UI

**@domain** shared-ui
**@fileType** components
**@ai-summary** Shared UI used by Payload admin extensions, admin-only chat, and Payload content renderers.

---

This directory is the small UI surface that remains after removing the public web app.

## Structure

```
ui/shared/
├── chat/                 # Admin chat UI
├── components/           # Reusable UI primitives
├── exerciserenderer/     # Exercise/block previews used by admin flows
├── footer/               # Payload Footer global config
├── header/               # Payload Header global config
├── heros/                # Payload Page hero field config
├── media/                # Media preview/rendering components
├── primitives/           # Low-level shared rendering helpers
├── providers/I18n/       # Client i18n provider
├── search/               # Search plugin config helpers
└── RichText/             # Lexical rich text renderer
```

Use `src/ui/admin/` for Payload admin-specific controls and `src/ui/shared/` only for UI that is reused by admin pages, admin widgets, or Payload block renderers.
