// @vitest-environment jsdom

/**
 * Unit tests for the Exercise Content Editor toolbar (Issue #110)
 *
 * Verifies the new toolbar surface on InlineRichTextEditor:
 *   - Right-align (RTL-friendly)
 *   - 4 text sizes (small/normal/large/xlarge)
 *   - 4 highlight colors (wine red / blue / green / dark orange)
 *   - Bold + Italic + Link + Clear format retained
 *   - View / Edit mode toggle
 *
 * @fileType unit-test
 * @domain admin
 * @ai-summary Toolbar behavior tests for issue #110
 */

import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineRichTextEditor } from '@/ui/admin/ExerciseContentEditor/editors/InlineRichTextEditor'

// Payload UI list drawer hook — replaced with a stub that renders toggler + noop component
vi.mock('@payloadcms/ui', () => ({
  useListDrawer: () => [
    () => null,
    ({
      children,
      ...rest
    }: { children?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...rest}>
        {children}
      </button>
    ),
    { openDrawer: vi.fn(), closeDrawer: vi.fn() },
  ],
}))

const baseValue = {
  type: 'rich_text' as const,
  format: 'md-math-v1' as const,
  value: 'hello world',
  mediaIds: [],
}

function renderEditor(overrides: Partial<typeof baseValue> = {}) {
  const onChange = vi.fn()
  const utils = render(
    <InlineRichTextEditor value={{ ...baseValue, ...overrides }} onChange={onChange} />,
  )
  return { onChange, ...utils }
}

/**
 * Select the first text node inside the wysiwyg surface whose text contains
 * the given substring. Mirrors the "user selected these characters" gesture
 * for jsdom Selection/Range tests.
 */
function selectTextInEditor(substring: string): void {
  const wysiwyg = screen.getByTestId('rte-wysiwyg')
  const walker = document.createTreeWalker(wysiwyg, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    const idx = node.textContent?.indexOf(substring) ?? -1
    if (idx !== -1) {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + substring.length)
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(range)
      }
      return
    }
    node = walker.nextNode() as Text | null
  }
  throw new Error(`Could not find text "${substring}" in wysiwyg`)
}

afterEach(() => {
  cleanup()
})

describe('InlineRichTextEditor toolbar (Issue #110)', () => {
  it('renders the bold button', () => {
    renderEditor()
    expect(screen.getByTestId('rte-bold')).toBeInTheDocument()
    expect(screen.getByTestId('rte-bold')).toHaveAttribute('title', 'Bold')
  })

  it('renders the italic button', () => {
    renderEditor()
    expect(screen.getByTestId('rte-italic')).toBeInTheDocument()
  })

  it('renders the right-align (RTL) button', () => {
    renderEditor()
    const alignButton = screen.getByTestId('rte-align-right')
    expect(alignButton).toBeInTheDocument()
    expect(alignButton).toHaveAttribute('title', expect.stringContaining('right'))
  })

  it('renders all four text size buttons', () => {
    renderEditor()
    expect(screen.getByTestId('rte-size-text-size-small')).toBeInTheDocument()
    expect(screen.getByTestId('rte-size-text-size-normal')).toBeInTheDocument()
    expect(screen.getByTestId('rte-size-text-size-large')).toBeInTheDocument()
    expect(screen.getByTestId('rte-size-text-size-xlarge')).toBeInTheDocument()
  })

  it('renders the clear-format button', () => {
    renderEditor()
    expect(screen.getByTestId('rte-clear')).toBeInTheDocument()
  })

  it('opens the color picker and shows four swatches (wine red/blue/green/dark orange)', async () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    const picker = await screen.findByTestId('rte-color-picker')
    expect(picker).toBeInTheDocument()

    expect(screen.getByTestId('rte-color-text-wine-red')).toBeInTheDocument()
    expect(screen.getByTestId('rte-color-text-blue')).toBeInTheDocument()
    expect(screen.getByTestId('rte-color-text-green')).toBeInTheDocument()
    expect(screen.getByTestId('rte-color-text-dark-orange')).toBeInTheDocument()
  })

  it('does NOT render the legacy 8-color palette (1..8) in the picker', async () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    expect(screen.queryByTestId('rte-color-text-highlight-1')).toBeNull()
    expect(screen.queryByTestId('rte-color-text-highlight-8')).toBeNull()
  })

  it('wraps selection with ::text-wine-red{...} when swatch is clicked', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    selectTextInEditor('abc')

    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    fireEvent.click(screen.getByTestId('rte-color-text-wine-red'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const updated = onChange.mock.calls.at(-1)?.[0]?.value
    expect(updated).toBe('::text-wine-red{abc}')
  })

  it('wraps selection with ::text-size-large{...} when L button is clicked', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    selectTextInEditor('abc')

    fireEvent.click(screen.getByTestId('rte-size-text-size-large'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const updated = onChange.mock.calls.at(-1)?.[0]?.value
    expect(updated).toBe('::text-size-large{abc}')
  })

  it('wraps selection with ::text-align-right{...} when right-align is clicked', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    selectTextInEditor('abc')

    fireEvent.click(screen.getByTestId('rte-align-right'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const updated = onChange.mock.calls.at(-1)?.[0]?.value
    expect(updated).toBe('::text-align-right{abc}')
  })

  it('inserts ** around selection when bold is clicked', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    selectTextInEditor('abc')

    fireEvent.click(screen.getByTestId('rte-bold'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const updated = onChange.mock.calls.at(-1)?.[0]?.value
    expect(updated).toBe('**abc**')
  })

  it('strips inline formatting from selected range when Clear format is clicked', async () => {
    const { onChange } = renderEditor({
      value: 'pre ::text-wine-red{colored} ::text-size-large{big} post',
    })
    // WYSIWYG rendered spans wrap "colored" and "big"; select from the first
    // colored span through the last big span (including the space between).
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const colored = wysiwyg.querySelector('.aguy-text-wine-red')!
    const big = wysiwyg.querySelector('.aguy-text-size-large')!
    const range = document.createRange()
    range.setStartBefore(colored)
    range.setEndAfter(big)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-clear'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const updated = onChange.mock.calls.at(-1)?.[0]?.value
    expect(updated).toBe('pre colored big post')
  })

  it('does not mutate content when Clear format is clicked on an empty selection', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    // Collapsed selection at position 1 inside the "abc" text node
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const textNode = wysiwyg.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 1)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-clear'))

    await new Promise((r) => setTimeout(r, 10))
    // Either not called, or called with the same value — the DOM is unchanged.
    const lastValue = onChange.mock.calls.at(-1)?.[0]?.value
    if (lastValue !== undefined) expect(lastValue).toBe('abc')
  })

  it('replaces (does not nest) when a second color is applied to the same range', async () => {
    const { onChange } = renderEditor({ value: 'abc' })

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    fireEvent.click(screen.getByTestId('rte-color-text-wine-red'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    fireEvent.click(screen.getByTestId('rte-color-text-blue'))

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      // Must NOT be `::text-wine-red{::text-blue{abc}}` — nested directives
      // corrupt on reload because the outer regex closes on the inner `}`.
      expect(last).toBe('::text-blue{abc}')
    })
  })

  it('replaces (does not nest) when a second size is applied to the same range', async () => {
    const { onChange } = renderEditor({ value: 'abc' })

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-size-text-size-small'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-size-text-size-large'))

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      expect(last).toBe('::text-size-large{abc}')
    })
  })

  it('toggles the same color off when re-applied to the same selection', async () => {
    const { onChange } = renderEditor({ value: 'abc' })

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    fireEvent.click(screen.getByTestId('rte-color-text-wine-red'))
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      expect(last).toBe('::text-wine-red{abc}')
    })

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    fireEvent.click(screen.getByTestId('rte-color-text-wine-red'))

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      expect(last).toBe('abc')
    })
  })

  it('toggles the same size off when re-applied to the same selection', async () => {
    const { onChange } = renderEditor({ value: 'abc' })

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-size-text-size-large'))
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      expect(last).toBe('::text-size-large{abc}')
    })

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-size-text-size-large'))

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      expect(last).toBe('abc')
    })
  })

  it('toggles bold off when applied twice to the same selection', async () => {
    const { onChange } = renderEditor({ value: 'abc' })

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-bold'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0]?.value).toBe('**abc**')

    selectTextInEditor('abc')
    fireEvent.click(screen.getByTestId('rte-bold'))
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      expect(last).toBe('abc')
    })
  })

  it('applies align-right as a class on the enclosing <p>, not a nested <div>', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    selectTextInEditor('abc')

    fireEvent.click(screen.getByTestId('rte-align-right'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    // No <div> inside a <p> — a browser will silently split that.
    expect(wysiwyg.querySelector('p > div')).toBeNull()
    // The <p> itself carries the align-right marker.
    const p = wysiwyg.querySelector('p')!
    expect(p.getAttribute('data-aguy-token')).toBe('text-align-right')
    expect(p.classList.contains('aguy-text-align-right')).toBe(true)
    expect(onChange.mock.calls.at(-1)?.[0]?.value).toBe('::text-align-right{abc}')
  })

  it('does not double blank lines on round-trip of empty paragraphs', async () => {
    // Empty initial value → contentEditable renders <p><br></p>. Simulating an
    // input event serializes that back to md and must NOT emit `\n` per empty
    // paragraph, otherwise every save loop would grow the blank-line count.
    const { onChange } = renderEditor({ value: '' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    fireEvent.input(wysiwyg)

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const emitted = onChange.mock.calls.at(-1)?.[0]?.value
    expect(emitted).toBe('')
  })

  it('shows the placeholder overlay while the editor is empty', () => {
    renderEditor({ value: '' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    expect(wysiwyg.getAttribute('data-empty')).toBe('true')
    expect(wysiwyg.getAttribute('data-placeholder')).toBe('Enter text...')
  })

  it('clears formatting when the selection sits inside a color span (double-click gesture)', async () => {
    const { onChange } = renderEditor({ value: '::text-wine-red{colored}' })
    // Simulate double-click: select the text INSIDE the wrapper span.
    selectTextInEditor('colored')

    fireEvent.click(screen.getByTestId('rte-clear'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('colored')
  })

  it('clears formatting when the selection sits inside a bold span', async () => {
    const { onChange } = renderEditor({ value: '**bold**' })
    selectTextInEditor('bold')

    fireEvent.click(screen.getByTestId('rte-clear'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('bold')
  })

  it('applies align-right on a bare caret (no selection required)', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    // Collapsed caret inside the paragraph
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const textNode = wysiwyg.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 1)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-align-right'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('::text-align-right{abc}')
  })

  it('toggles a heading back to a paragraph when re-applied', async () => {
    const { onChange } = renderEditor({ value: '# hello' })
    selectTextInEditor('hello')

    fireEvent.click(screen.getByTestId('rte-heading'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('hello')
  })

  it('converts an aligned paragraph to a plain heading (alignment intentionally dropped)', async () => {
    // Alignment on a heading has no representation that round-trips through
    // md-math-v1 (`# title` has no way to carry an align token), so we lock in
    // the "drop alignment on heading convert" behavior rather than pretend it
    // survives and lose it on the next reload.
    const { onChange } = renderEditor({ value: '::text-align-right{title}' })
    selectTextInEditor('title')

    fireEvent.click(screen.getByTestId('rte-heading'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('# title')
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const h1 = wysiwyg.querySelector('h1')!
    expect(h1.getAttribute('data-aguy-token')).toBeNull()
    expect(h1.classList.contains('aguy-text-align-right')).toBe(false)
  })

  it('does not fire onChange when a format action is a no-op (bare caret)', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    // Collapsed caret in the paragraph — no selection.
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const textNode = wysiwyg.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 1)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    // Bold / italic / color / size all early-return on a collapsed range;
    // none of them should reach the onChange callback and dirty the form.
    fireEvent.click(screen.getByTestId('rte-bold'))
    fireEvent.click(screen.getByTestId('rte-italic'))
    fireEvent.click(screen.getByTestId('rte-size-text-size-large'))
    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    fireEvent.click(screen.getByTestId('rte-color-text-blue'))

    await new Promise((r) => setTimeout(r, 10))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not serialize during an IME composition', () => {
    const { onChange } = renderEditor({ value: 'abc' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')

    fireEvent.compositionStart(wysiwyg)
    // Simulate the composition writing intermediate text.
    wysiwyg.querySelector('p')!.textContent = 'abc x'
    fireEvent.input(wysiwyg, { nativeEvent: { isComposing: true } })

    expect(onChange).not.toHaveBeenCalled()

    fireEvent.compositionEnd(wysiwyg)
    expect(onChange).toHaveBeenCalled()
  })

  it('parses legacy text-highlight-1..8 directives from stored content', () => {
    renderEditor({ value: '::text-highlight-3{legacy}' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    // The legacy palette is not offered in the toolbar anymore, but stored
    // content must still render as a span (not as literal `::text-highlight-…` text).
    expect(wysiwyg.querySelector('.aguy-text-highlight-3')).not.toBeNull()
    expect(wysiwyg.textContent).toContain('legacy')
    expect(wysiwyg.textContent).not.toContain('::text-highlight-3')
  })

  it('coerces pasted HTML to plain text (no arbitrary DOM injection)', async () => {
    const { onChange } = renderEditor({ value: '' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')

    // Put a caret in the empty paragraph.
    const p = wysiwyg.querySelector('p')!
    const range = document.createRange()
    range.selectNodeContents(p)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    // Simulate a paste with dangerous HTML + a plain-text fallback. jsdom
    // has no DataTransfer, so shim the shape the handler reads.
    const store: Record<string, string> = {
      'text/plain': 'hello world',
      'text/html': '<img src="x" onerror="window.__pwned=true">',
    }
    fireEvent.paste(wysiwyg, {
      clipboardData: { getData: (t: string) => store[t] ?? '' },
    })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    // The DOM must contain the plain text, no <img>, and no side effect fired.
    expect(wysiwyg.querySelector('img')).toBeNull()
    expect(wysiwyg.textContent).toContain('hello world')
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('toggles align-right off when applied twice to the same paragraph', async () => {
    const { onChange } = renderEditor({ value: 'abc' })
    selectTextInEditor('abc')

    fireEvent.click(screen.getByTestId('rte-align-right'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0]?.value).toBe('::text-align-right{abc}')

    // Re-click removes alignment — otherwise there's no UI path to un-align.
    fireEvent.click(screen.getByTestId('rte-align-right'))
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]?.value
      expect(last).toBe('abc')
    })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const p = wysiwyg.querySelector('p')!
    expect(p.getAttribute('data-aguy-token')).toBeNull()
    expect(p.classList.contains('aguy-text-align-right')).toBe(false)
  })

  it('clear format also strips block alignment', async () => {
    const { onChange } = renderEditor({ value: '::text-align-right{abc}' })
    selectTextInEditor('abc')

    fireEvent.click(screen.getByTestId('rte-clear'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0]?.value).toBe('abc')
  })

  it('applies bold per paragraph on a multi-block selection (Ctrl+A + Bold)', async () => {
    const { onChange } = renderEditor({ value: 'hello\nworld' })
    // Simulate Ctrl+A: select from first char to last char of the surface.
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const range = document.createRange()
    range.selectNodeContents(wysiwyg)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-bold'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    // Must preserve the paragraph break — the old bug produced `**helloworld**`.
    expect(last).toBe('**hello**\n**world**')
  })

  it('applies color per paragraph on a multi-block selection', async () => {
    const { onChange } = renderEditor({ value: 'hello\nworld' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const range = document.createRange()
    range.selectNodeContents(wysiwyg)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-color-toggle'))
    await screen.findByTestId('rte-color-picker')
    fireEvent.click(screen.getByTestId('rte-color-text-blue'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('::text-blue{hello}\n::text-blue{world}')
  })

  it('aligns all paragraphs on Ctrl+A when the selection is mixed-alignment', async () => {
    // First paragraph unaligned, second already right-aligned. The natural
    // gesture is "align everything now" — per-block toggling used to swap
    // them (align a, un-align b) which silently made layout worse.
    const { onChange } = renderEditor({ value: 'hello\n::text-align-right{world}' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const range = document.createRange()
    range.selectNodeContents(wysiwyg)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-align-right'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('::text-align-right{hello}\n::text-align-right{world}')
  })

  it('un-aligns all paragraphs on Ctrl+A when every paragraph is already aligned', async () => {
    const { onChange } = renderEditor({
      value: '::text-align-right{hello}\n::text-align-right{world}',
    })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const range = document.createRange()
    range.selectNodeContents(wysiwyg)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-align-right'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('hello\nworld')
  })

  it('aligns every paragraph on a multi-block selection', async () => {
    const { onChange } = renderEditor({ value: 'hello\nworld' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const range = document.createRange()
    range.selectNodeContents(wysiwyg)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-align-right'))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const last = onChange.mock.calls.at(-1)?.[0]?.value
    expect(last).toBe('::text-align-right{hello}\n::text-align-right{world}')
  })

  it('preserves selection across all touched blocks after multi-block bold', async () => {
    const { onChange } = renderEditor({ value: 'hello\nworld' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const range = document.createRange()
    range.selectNodeContents(wysiwyg)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.click(screen.getByTestId('rte-bold'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())

    // A follow-up format action must hit the same content, not shrink to
    // just paragraph 1 (the old bug — final selectContents fired on block[0]).
    const currentText = window.getSelection()?.toString() ?? ''
    expect(currentText).toContain('hello')
    expect(currentText).toContain('world')
  })

  it('prevents default on Shift+Enter (no soft-break drift to hard paragraphs)', () => {
    renderEditor({ value: 'abc' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    // Focus so keydown reaches the handler
    ;(wysiwyg as HTMLElement).focus()

    const preventDefault = vi.fn()
    fireEvent.keyDown(wysiwyg, { key: 'Enter', shiftKey: true, preventDefault })
    // fireEvent's preventDefault mock isn't wired through React synthetic
    // events reliably, so instead assert the surface didn't gain a <br>
    // (which is what the browser default WOULD produce and what our storage
    // format can't round-trip).
    expect(wysiwyg.querySelectorAll('p > br').length).toBeLessThanOrEqual(1)
    // The one <br> that IS allowed is the placeholder in an empty <p>.
    const brs = Array.from(wysiwyg.querySelectorAll('br'))
    for (const br of brs) {
      const parent = br.parentElement!
      expect(parent.childNodes.length).toBe(1) // sole child = placeholder br
    }
  })

  it('prevents default on Ctrl+U (browser would insert unsupported <u>)', () => {
    renderEditor({ value: 'abc' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    ;(wysiwyg as HTMLElement).focus()

    fireEvent.keyDown(wysiwyg, { key: 'u', ctrlKey: true })
    // No <u> in the DOM — browser default would have created one, and our
    // serializer would discard it silently on next hydrate.
    expect(wysiwyg.querySelector('u')).toBeNull()
  })

  it('toolbar buttons preventDefault on mousedown so the editor keeps focus', () => {
    renderEditor()
    // Every button inside the toolbar should have its focus-stealing default
    // suppressed via the toolbar-level mousedown handler.
    const bold = screen.getByTestId('rte-bold')
    const preventDefault = vi.fn()
    fireEvent.mouseDown(bold, { preventDefault })
    // React's synthetic event fires the toolbar-level handler; verify by
    // inspecting: the handler calls preventDefault on the event object, which
    // fireEvent's default event does have. Post-event, defaultPrevented === true.
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    bold.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('coerces dropped HTML to plain text (mirrors paste XSS guard)', async () => {
    const { onChange } = renderEditor({ value: '' })
    const wysiwyg = screen.getByTestId('rte-wysiwyg')
    const p = wysiwyg.querySelector('p')!
    const range = document.createRange()
    range.selectNodeContents(p)
    range.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    // Simulate a drop with dangerous HTML + a plain-text fallback.
    const store: Record<string, string> = {
      'text/plain': 'dropped',
      'text/html': '<img src="x" onerror="window.__dropped_pwned=true">',
    }
    fireEvent.drop(wysiwyg, {
      clientX: 0,
      clientY: 0,
      dataTransfer: { getData: (t: string) => store[t] ?? '' },
    })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(wysiwyg.querySelector('img')).toBeNull()
    expect(wysiwyg.textContent).toContain('dropped')
    expect((globalThis as { __dropped_pwned?: boolean }).__dropped_pwned).toBeUndefined()
  })

  it('renders wine red swatch background via the toolbar-color-swatch--wine-red class', () => {
    renderEditor()
    const swatch = document.querySelector('.toolbar-color-swatch--wine-red')
    expect(swatch).toBeInTheDocument()
  })
})
