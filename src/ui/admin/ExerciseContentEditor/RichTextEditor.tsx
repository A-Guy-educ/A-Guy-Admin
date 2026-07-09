'use client'

import React from 'react'
import {
  Bold,
  Italic,
  Code,
  Sigma,
  Heading1,
  Link as LinkIcon,
  AlignRight,
  Eraser,
  Eye,
  Pencil,
} from 'lucide-react'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'

interface RichTextEditorProps {
  value: string
  onChange: (val: string) => void
}

type HighlightToken = 'text-wine-red' | 'text-blue' | 'text-green' | 'text-dark-orange'
type SizeToken = 'text-size-small' | 'text-size-normal' | 'text-size-large' | 'text-size-xlarge'

const HIGHLIGHT_OPTIONS: ReadonlyArray<{
  token: HighlightToken
  label: string
  className: string
}> = [
  { token: 'text-wine-red', label: 'Wine red', className: 'color-option--wine-red' },
  { token: 'text-blue', label: 'Blue', className: 'color-option--blue' },
  { token: 'text-green', label: 'Green', className: 'color-option--green' },
  { token: 'text-dark-orange', label: 'Dark orange', className: 'color-option--dark-orange' },
]

const SIZE_OPTIONS: ReadonlyArray<{ token: SizeToken; label: string; ariaLabel: string }> = [
  { token: 'text-size-small', label: 'S', ariaLabel: 'Small' },
  { token: 'text-size-normal', label: 'M', ariaLabel: 'Normal' },
  { token: 'text-size-large', label: 'L', ariaLabel: 'Large' },
  { token: 'text-size-xlarge', label: 'XL', ariaLabel: 'Extra large' },
]

const DIRECTIVE_PATTERN =
  /::(text-(?:highlight-[1-8]|wine-red|blue|green|dark-orange|size-(?:small|normal|large|xlarge)|align-right))\{([^}]*)\}/g

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange }) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [showColorPicker, setShowColorPicker] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<'edit' | 'view'>('edit')
  const colorPickerRef = React.useRef<HTMLDivElement>(null)

  const insertText = (before: string, after: string = '') => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value
    const selection = text.substring(start, end)

    const newValue = text.substring(0, start) + before + selection + after + text.substring(end)

    onChange(newValue)

    // Restore focus and selection
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + before.length, end + before.length)
    }, 0)
  }

  const wrapSelection = (marker: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value
    const selection = text.substring(start, end)
    const before = `::${marker}{`
    const after = `}`

    const wrapped = selection.length > 0 ? `${before}${selection}${after}` : `${before}${after}`
    const newValue = text.substring(0, start) + wrapped + text.substring(end)

    onChange(newValue)

    setTimeout(() => {
      textarea.focus()
      if (selection.length > 0) {
        textarea.setSelectionRange(start + before.length, end + before.length)
      } else {
        textarea.setSelectionRange(start + before.length, start + before.length)
      }
    }, 0)
  }

  const clearFormat = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value

    if (start === end) return

    const selection = text.substring(start, end)
    const stripped = selection.replace(DIRECTIVE_PATTERN, '$2')

    if (stripped === selection) return

    const newValue = text.substring(0, start) + stripped + text.substring(end)
    onChange(newValue)

    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start, start + stripped.length)
    }, 0)
  }

  const insertHighlight = (token: HighlightToken) => {
    wrapSelection(token)
    setShowColorPicker(false)
  }

  const insertSize = (token: SizeToken) => {
    wrapSelection(token)
  }

  // Click-outside handler
  React.useEffect(() => {
    if (!showColorPicker) return

    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setShowColorPicker(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showColorPicker])

  const isEditMode = viewMode === 'edit'

  return (
    <div className="rich-text-editor" data-mode={viewMode}>
      <div
        className={`rich-text-toolbar ${isEditMode ? '' : 'rich-text-toolbar--view'}`}
        role="toolbar"
        aria-label="Rich text formatting"
      >
        {isEditMode ? (
          <>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => insertText('**', '**')}
              title="Bold"
              aria-label="Bold"
              data-testid="rte-bold"
            >
              <Bold size={14} />
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => insertText('*', '*')}
              title="Italic"
              aria-label="Italic"
              data-testid="rte-italic"
            >
              <Italic size={14} />
            </button>
            <div className="toolbar-divider" />
            <button
              type="button"
              className="toolbar-button"
              onClick={() => insertText('# ')}
              title="Heading"
              aria-label="Heading"
              data-testid="rte-heading"
            >
              <Heading1 size={14} />
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => insertText('`', '`')}
              title="Code"
              aria-label="Code"
              data-testid="rte-code"
            >
              <Code size={14} />
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => insertText('$', '$')}
              title="Math (Inline)"
              aria-label="Math"
              data-testid="rte-math"
            >
              <Sigma size={14} />
            </button>
            <div className="toolbar-divider" />
            <button
              type="button"
              className="toolbar-button"
              onClick={() => insertText('[', '](url)')}
              title="Link"
              aria-label="Link"
              data-testid="rte-link"
            >
              <LinkIcon size={14} />
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => wrapSelection('text-align-right')}
              title="Align right (RTL-friendly)"
              aria-label="Align right"
              data-testid="rte-align-right"
            >
              <AlignRight size={14} />
            </button>
            <div className="toolbar-divider" />
            <div
              className="toolbar-size-group"
              role="group"
              aria-label="Text size"
              data-testid="rte-size-group"
            >
              {SIZE_OPTIONS.map((option) => (
                <button
                  key={option.token}
                  type="button"
                  className="toolbar-button toolbar-button--size"
                  onClick={() => insertSize(option.token)}
                  title={option.ariaLabel}
                  aria-label={option.ariaLabel}
                  data-size={option.token}
                  data-testid={`rte-size-${option.token}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="toolbar-divider" />
            <div className="toolbar-button-wrapper" ref={colorPickerRef}>
              <button
                type="button"
                className="toolbar-button toolbar-button--color"
                onClick={() => setShowColorPicker(!showColorPicker)}
                title="Highlight color"
                aria-label="Highlight color"
                aria-expanded={showColorPicker}
                data-testid="rte-color-toggle"
              >
                <span className="toolbar-color-swatch toolbar-color-swatch--wine-red" aria-hidden />
              </button>
              {showColorPicker && (
                <div className="color-picker-dropdown" role="menu" data-testid="rte-color-picker">
                  {HIGHLIGHT_OPTIONS.map((option) => (
                    <button
                      key={option.token}
                      type="button"
                      className={`color-option ${option.className}`}
                      onClick={() => insertHighlight(option.token)}
                      title={option.label}
                      aria-label={option.label}
                      data-testid={`rte-color-${option.token}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="toolbar-button"
              onClick={clearFormat}
              title="Clear format"
              aria-label="Clear format"
              data-testid="rte-clear"
            >
              <Eraser size={14} />
            </button>
            <div className="toolbar-spacer" />
            <button
              type="button"
              className="toolbar-button toolbar-button--mode"
              onClick={() => setViewMode('view')}
              title="Switch to view mode"
              aria-label="Switch to view mode"
              aria-pressed={false}
              data-testid="rte-toggle-view"
            >
              <Eye size={14} />
              <span className="toolbar-button-label">View</span>
            </button>
          </>
        ) : (
          <>
            <span className="toolbar-mode-label">
              <Eye size={14} aria-hidden /> View mode
            </span>
            <div className="toolbar-spacer" />
            <button
              type="button"
              className="toolbar-button toolbar-button--mode toolbar-button--active"
              onClick={() => setViewMode('edit')}
              title="Switch to edit mode"
              aria-label="Switch to edit mode"
              aria-pressed={true}
              data-testid="rte-toggle-edit"
            >
              <Pencil size={14} />
              <span className="toolbar-button-label">Edit</span>
            </button>
          </>
        )}
      </div>

      {isEditMode ? (
        <textarea
          ref={textareaRef}
          className="rich-text-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter markdown content..."
          dir="auto"
          data-testid="rte-textarea"
        />
      ) : (
        <div className="rich-text-preview rich-text-content" data-testid="rte-preview" dir="auto">
          {value.trim().length > 0 ? (
            <MathMarkdown content={value} />
          ) : (
            <span className="rich-text-preview-empty">Enter markdown content...</span>
          )}
        </div>
      )}

      <div className="rich-text-footer">
        {value.length} characters{!isEditMode ? ' · preview' : ''}
      </div>
    </div>
  )
}
