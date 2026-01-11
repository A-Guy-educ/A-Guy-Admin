# MediaPreview Components

## PDFPreview

A client-side PDF viewer component using PDF.js.

### Features

- Client-side only rendering (uses `'use client'` directive)
- Page navigation (previous/next buttons)
- Page counter display
- Loading and error states
- Responsive canvas rendering
- Automatic cleanup on unmount

### Usage

```tsx
import { PDFPreview } from '@/components/admin/MediaPreview'

function MyComponent() {
  return <PDFPreview url="https://example.com/sample.pdf" className="w-full max-w-4xl mx-auto" />
}
```

### Props

| Prop        | Type     | Required | Default | Description                              |
| ----------- | -------- | -------- | ------- | ---------------------------------------- |
| `url`       | `string` | Yes      | -       | URL of the PDF file to display           |
| `className` | `string` | No       | `''`    | Additional CSS classes for the container |

### Technical Details

- Uses PDF.js library (`pdfjs-dist`)
- Worker loaded from CDN (cdnjs.cloudflare.com)
- Default scale: 1.5x
- Canvas-based rendering
- Automatically destroys PDF document on unmount

### Example in Payload Admin Panel

```tsx
// In a collection field component
import type { UploadFieldClientComponent } from 'payload'
import { PDFPreview } from '@/components/admin/MediaPreview'

export const PDFFieldPreview: UploadFieldClientComponent = (props) => {
  const { value } = props

  if (typeof value === 'object' && value?.url) {
    return <PDFPreview url={value.url} />
  }

  return null
}
```

### Styling

The component uses Tailwind CSS utility classes and design system tokens:

- `border-border` - Border color from design system
- `bg-muted/30` - Background with opacity
- `text-muted-foreground` - Muted text color
- `text-destructive` - Error text color
- `bg-primary` - Button background
- `text-primary-foreground` - Button text

All colors use CSS variables from `globals.css` for theme support.
