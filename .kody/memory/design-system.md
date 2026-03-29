# Design System

## Styling Stack

**Framework**: Tailwind CSS 4 + CVA (class-variance-authority)
**Primitives**: Radix UI (accessible)
**Component Pattern**: shadcn/ui-style (CVA variants + `cn()` utility)
**Icons**: Lucide React
**Theming**: CSS variables with `[data-theme]` selector (light/dark)

## Token Files

- `tailwind.tokens.mjs` — semantic design tokens (spacing, shadows, typography, etc.)
- `tailwind.config.mjs` — Tailwind theme extension using tokens
- `src/app/(frontend)/globals.css` — CSS variables for colors (light/dark)

## Mandatory Rules

### Typography — ALWAYS use semantic tokens

| Context | Token | NOT this |
|---------|-------|----------|
| Hero/display | `text-display-2xl` to `text-display-sm` | `text-5xl`, `text-4xl`, `text-3xl` |
| Section headings | `text-heading-xl` to `text-heading-sm` | `text-2xl`, `text-xl`, `text-lg` |
| Body content | `text-body-xl` to `text-body-xs` | `text-base`, `text-sm`, `text-xs` |
| Labels/badges | `text-label` | `text-[10px]`, `text-xs font-medium` |

**NEVER use inline `style={{ fontSize: ... }}`** — always use className with tokens.

### Colors — ALWAYS use Tailwind utilities

| Do this | NOT this |
|---------|----------|
| `bg-primary`, `text-primary` | `bg-[hsl(var(--primary))]` |
| `bg-success/10`, `text-success` | `bg-[hsl(var(--success))]/10` |
| `text-destructive` | `text-red-500`, `text-red-600` |
| `text-muted-foreground` | `text-gray-500`, `text-slate-500` |
| `bg-muted` | `bg-gray-50`, `bg-gray-100` |
| `bg-card` | `bg-white` |
| `text-foreground` | `text-slate-900`, `text-black` |
| `bg-primary/5` | `bg-[hsl(var(--primary-soft))]` |
| `border-primary/20` | `border-[hsl(var(--primary))]/20` |

Available semantic colors: `primary`, `primary-soft`, `secondary`, `accent`, `muted`, `card`, `destructive`, `success`, `warning`, `error`, `foreground`, `background`, `border`, `hover`, `selected`, `form`, `elevated`.

### Shadows — ALWAYS use tokens

| Do this | NOT this |
|---------|----------|
| `shadow-elevation-1` to `shadow-elevation-4` | `shadow-sm`, `shadow-md`, `shadow-lg` |
| `shadow-card`, `shadow-card-hover` | `shadow-[0_1px_2px_...]` |
| `shadow-modal` | `shadow-xl` with custom values |
| `shadow-dropdown` | inline shadow strings |

### Spacing — prefer semantic tokens

| Do this | NOT this |
|---------|----------|
| `p-card-padding` (24px) | `p-6` |
| `p-card-padding-sm` (16px) | `p-4` |
| `p-card-padding-lg` (32px) | `p-8` |
| `gap-content-gap` (24px) | `gap-6` |
| `gap-content-gap-sm` (16px) | `gap-4` |
| `py-section-sm` (48px) | `py-12` |
| `py-section-md` (64px) | `py-16` |

Small spacing (`px-2`, `py-1`, `gap-2`, `mt-1`) is fine as-is — tokens are for structural layout spacing.

### Transitions — REQUIRED on interactive elements

Every interactive element (buttons, cards, links, toggles, tabs) MUST have:
- Buttons: `transition-all duration-normal`
- Form inputs: `transition-colors duration-fast`
- Cards: `transition-all duration-normal`
- Hover-elevated cards: add `hover:shadow-card-hover`

Duration tokens: `duration-fast` (100ms), `duration-normal` (200ms), `duration-slow` (300ms).

### Form Elements — unified pattern

Input, Select, and Textarea share identical base styling:
- Height: `h-10` (40px)
- Border: `border border-form-border`
- Background: `bg-form`
- Text: `text-body-sm`
- Focus: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- Disabled: `disabled:cursor-not-allowed disabled:opacity-disabled`
- Transition: `transition-colors duration-fast`
- Radius: `rounded-md`

### Disabled State

Use `opacity-disabled` (0.5) instead of `opacity-50` for disabled elements.

## Component Patterns

### Cards
```
rounded-lg border bg-card text-card-foreground shadow-elevation-1 transition-all duration-normal
```

### Interactive Cards (hoverable)
```
rounded-lg border bg-card shadow-card hover:shadow-card-hover transition-all duration-normal
```

### Buttons (base via CVA)
```
rounded-md text-body-sm transition-all duration-normal
```

### Skeleton Loading
Use `Skeleton`, `SkeletonText`, `SkeletonCard` from `@/ui/web/components/skeleton` for loading states.

## cn() Utility

Always use `cn()` from `@/infra/utils/ui` for className composition. Never use template literals for conditional classes.

```typescript
// CORRECT
className={cn('base-classes', condition && 'conditional-class', className)}

// WRONG
className={`base-classes ${condition ? 'conditional-class' : ''}`}
```
