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

  it('toggles to view mode and shows rendered preview instead of the wysiwyg surface', async () => {
    const { onChange: _onChange } = renderEditor({ value: '::text-wine-red{colored} text' })

    expect(screen.getByTestId('rte-wysiwyg')).toBeInTheDocument()
    expect(screen.queryByTestId('rte-preview')).toBeNull()

    fireEvent.click(screen.getByTestId('rte-toggle-view'))

    await waitFor(() => {
      expect(screen.getByTestId('rte-preview')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('rte-wysiwyg')).toBeNull()
    // Edit-mode controls are gone
    expect(screen.queryByTestId('rte-bold')).toBeNull()
    // The Edit toggle is now visible
    expect(screen.getByTestId('rte-toggle-edit')).toBeInTheDocument()
  })

  it('toggles back to edit mode and restores the wysiwyg surface', async () => {
    renderEditor({ value: 'some content' })

    fireEvent.click(screen.getByTestId('rte-toggle-view'))
    await screen.findByTestId('rte-preview')

    fireEvent.click(screen.getByTestId('rte-toggle-edit'))

    await waitFor(() => {
      expect(screen.getByTestId('rte-wysiwyg')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('rte-preview')).toBeNull()
  })

  it('shows placeholder text in view mode when value is empty', async () => {
    renderEditor({ value: '' })

    fireEvent.click(screen.getByTestId('rte-toggle-view'))

    await screen.findByTestId('rte-preview')
    expect(screen.getByTestId('rte-preview').textContent).toContain('Enter text')
  })

  it('renders wine red swatch background via the toolbar-color-swatch--wine-red class', () => {
    renderEditor()
    const swatch = document.querySelector('.toolbar-color-swatch--wine-red')
    expect(swatch).toBeInTheDocument()
  })
})
