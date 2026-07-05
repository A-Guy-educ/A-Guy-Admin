// @vitest-environment jsdom

/**
 * Unit Tests for RichTextEditor / InlineRichTextEditor RTL alignment (#114)
 *
 * Hebrew content typed into the textareas should be rendered right-aligned (RTL),
 * while English / math (LaTeX) content remains left-aligned (LTR). The standard
 * browser-native way to get this behavior is to set `dir="auto"` on the
 * <textarea> element. These tests pin both editor files to that contract.
 *
 * The RichTextEditor component has no Payload / Next.js runtime dependencies
 * inside its component body, so we can render it directly with
 * @testing-library/react and assert the rendered `dir` attribute. The
 * InlineRichTextEditor pulls in `useListDrawer` from `@payloadcms/ui` and
 * `next/image`, which makes a direct render impractical without a mock
 * surface — we assert the source-level contract via readFileSync, mirroring
 * the pattern used by sibling tests in this directory
 * (`lesson-blocks-field-autosave.spec.ts`, `transaction-detail-view-check.spec.ts`).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

import { RichTextEditor } from '@/ui/admin/ExerciseContentEditor/RichTextEditor'

const richTextEditorPath = path.resolve(
  process.cwd(),
  'src/ui/admin/ExerciseContentEditor/RichTextEditor.tsx',
)
const inlineRichTextEditorPath = path.resolve(
  process.cwd(),
  'src/ui/admin/ExerciseContentEditor/editors/InlineRichTextEditor.tsx',
)

afterEach(() => {
  cleanup()
})

describe('RichTextEditor textarea supports RTL via dir="auto" (#114)', () => {
  it('source file declares dir="auto" on the rich-text-textarea element', () => {
    const content = readFileSync(richTextEditorPath, 'utf-8')

    // The <textarea className="rich-text-textarea" .../> block should declare
    // dir="auto" so Hebrew content aligns right while English/math stays LTR.
    expect(content).toMatch(/<textarea[\s\S]*?className="rich-text-textarea"[\s\S]*?dir="auto"/)
  })

  it('renders the textarea with dir="auto" so browser auto-detects RTL', () => {
    render(<RichTextEditor value="hello" onChange={() => undefined} />)

    const textarea = screen.getByPlaceholderText('Enter markdown content...') as HTMLTextAreaElement
    expect(textarea).toBeDefined()
    expect(textarea.getAttribute('dir')).toBe('auto')
  })
})

describe('InlineRichTextEditor textarea supports RTL via dir="auto" (#114)', () => {
  it('source file declares dir="auto" on the inline-rich-text-textarea element', () => {
    const content = readFileSync(inlineRichTextEditorPath, 'utf-8')

    // The <textarea className="inline-rich-text-textarea" .../> block should
    // declare dir="auto" for the same RTL auto-detection behavior.
    expect(content).toMatch(
      /<textarea[\s\S]*?className="inline-rich-text-textarea"[\s\S]*?dir="auto"/,
    )
  })
})
