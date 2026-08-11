'use client'

import React from 'react'
import type { InlineRichText } from '@/server/payload/collections/Exercises/types'
import type { Media } from '@/payload-types'
import { useListDrawer } from '@payloadcms/ui'
import {
  Bold,
  Italic,
  Code,
  Sigma,
  Heading1,
  Link as LinkIcon,
  Image as ImageIcon,
  X,
  AlignRight,
  Eraser,
  Eye,
  Pencil,
} from 'lucide-react'
import Image from 'next/image'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'
import { useEditorChrome } from '../EditorChromeContext'
import { WysiwygEditor, type WysiwygEditorHandle } from './wysiwyg/WysiwygEditor'

interface InlineRichTextEditorProps {
  value: InlineRichText
  onChange: (value: InlineRichText) => void
  placeholder?: string
  minHeight?: string
  /** Initial view mode. When omitted, falls back to EditorChromeContext's default. */
  defaultViewMode?: 'edit' | 'view'
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

export const InlineRichTextEditor: React.FC<InlineRichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Enter text...',
  minHeight = '80px',
  defaultViewMode,
}) => {
  const chrome = useEditorChrome()
  const wysiwygRef = React.useRef<WysiwygEditorHandle>(null)
  const [mediaItems, setMediaItems] = React.useState<Media[]>([])
  const [loadingMedia, setLoadingMedia] = React.useState(false)
  const [showColorPicker, setShowColorPicker] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<'edit' | 'view'>(
    defaultViewMode ?? chrome.defaultRichTextView,
  )
  const colorPickerRef = React.useRef<HTMLDivElement>(null)

  const [ListDrawer, ListDrawerToggler, { openDrawer, closeDrawer }] = useListDrawer({
    selectedCollection: 'media',
  })

  const updateValue = React.useCallback(
    (newValue: string) => {
      onChange({ ...value, value: newValue })
    },
    [value, onChange],
  )

  const insertHighlight = (token: HighlightToken) => {
    wysiwygRef.current?.applyToken(token)
    setShowColorPicker(false)
  }

  const insertSize = (token: SizeToken) => {
    wysiwygRef.current?.applyToken(token)
  }

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

  React.useEffect(() => {
    const fetchMedia = async () => {
      if (!value.mediaIds || value.mediaIds.length === 0) {
        setMediaItems([])
        return
      }

      setLoadingMedia(true)
      try {
        const fetchPromises = value.mediaIds.map((id) =>
          fetch(`/api/media/${id}`).then((res) => (res.ok ? res.json() : null)),
        )
        const results = await Promise.all(fetchPromises)
        setMediaItems(results.filter(Boolean) as Media[])
      } catch {
        setMediaItems([])
      } finally {
        setLoadingMedia(false)
      }
    }

    fetchMedia()
  }, [value.mediaIds])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDrawerSelect = (args: any) => {
    const newMediaId = args.docID
    const newMediaIds = [...(value.mediaIds || []), newMediaId]
    onChange({ ...value, mediaIds: newMediaIds })
    closeDrawer()
  }

  const handleRemoveMedia = (mediaId: string) => {
    const newMediaIds = (value.mediaIds || []).filter((id) => id !== mediaId)
    onChange({ ...value, mediaIds: newMediaIds })
  }

  const isEditMode = viewMode === 'edit'

  return (
    <div className="inline-rich-text-editor" data-mode={viewMode}>
      <div
        className={`inline-rich-text-toolbar ${isEditMode ? '' : 'inline-rich-text-toolbar--view'}`}
        role="toolbar"
        aria-label="Rich text formatting"
      >
        {isEditMode ? (
          <>
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.applyMark('strong')}
              title="Bold"
              type="button"
              aria-label="Bold"
              data-testid="rte-bold"
            >
              <Bold size={14} />
            </button>
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.applyMark('em')}
              title="Italic"
              type="button"
              aria-label="Italic"
              data-testid="rte-italic"
            >
              <Italic size={14} />
            </button>
            <div className="toolbar-divider" />
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.insertHeading()}
              title="Heading"
              type="button"
              aria-label="Heading"
              data-testid="rte-heading"
            >
              <Heading1 size={14} />
            </button>
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.insertAround('`', '`')}
              title="Code"
              type="button"
              aria-label="Code"
              data-testid="rte-code"
            >
              <Code size={14} />
            </button>
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.insertAround('$', '$')}
              title="Math (Inline)"
              type="button"
              aria-label="Math"
              data-testid="rte-math"
            >
              <Sigma size={14} />
            </button>
            <div className="toolbar-divider" />
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.insertAround('[', '](url)')}
              title="Link"
              type="button"
              aria-label="Link"
              data-testid="rte-link"
            >
              <LinkIcon size={14} />
            </button>
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.applyToken('text-align-right')}
              title="Align right (RTL-friendly)"
              type="button"
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
                  className="toolbar-button toolbar-button--size"
                  onClick={() => insertSize(option.token)}
                  title={option.ariaLabel}
                  type="button"
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
                className="toolbar-button toolbar-button--color"
                onClick={() => setShowColorPicker(!showColorPicker)}
                title="Highlight color"
                type="button"
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
                      className={`color-option ${option.className}`}
                      onClick={() => insertHighlight(option.token)}
                      title={option.label}
                      type="button"
                      aria-label={option.label}
                      data-testid={`rte-color-${option.token}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <button
              className="toolbar-button"
              onClick={() => wysiwygRef.current?.clearFormatting()}
              title="Clear format"
              type="button"
              aria-label="Clear format"
              data-testid="rte-clear"
            >
              <Eraser size={14} />
            </button>
            <div className="toolbar-divider" />
            <ListDrawerToggler
              onClick={openDrawer}
              className="toolbar-button toolbar-button--media"
              title="Attach media"
            >
              <ImageIcon size={14} />
            </ListDrawerToggler>
            <div className="toolbar-spacer" />
            <button
              className="toolbar-button toolbar-button--mode"
              onClick={() => setViewMode('view')}
              title="Switch to view mode"
              type="button"
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
              className="toolbar-button toolbar-button--mode toolbar-button--active"
              onClick={() => setViewMode('edit')}
              title="Switch to edit mode"
              type="button"
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
        <WysiwygEditor
          ref={wysiwygRef}
          value={value.value}
          onChange={updateValue}
          placeholder={placeholder}
          minHeight={minHeight}
        />
      ) : (
        <div
          className="inline-rich-text-preview rich-text-content"
          style={{ minHeight }}
          data-testid="rte-preview"
          dir="auto"
        >
          {value.value.trim().length > 0 ? (
            <MathMarkdown content={value.value} />
          ) : (
            <span className="inline-rich-text-preview-empty">{placeholder}</span>
          )}
        </div>
      )}

      {value.mediaIds && value.mediaIds.length > 0 && (
        <div className="inline-rich-text-media">
          {loadingMedia && <div className="inline-rich-text-media-loading">Loading media...</div>}
          {!loadingMedia && mediaItems.length > 0 && (
            <div className="inline-rich-text-media-list">
              {mediaItems.map((item) => {
                const isImage = item.type === 'image'
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const itemAny = item as any
                // Use thumbnailURL (set by adminThumbnail) first, then fall back to sizes.thumbnail.url
                const thumbnailUrl = item.thumbnailURL || itemAny.sizes?.thumbnail?.url || item.url
                return (
                  <div key={item.id} className="inline-rich-text-media-item">
                    {/* Show thumbnail for images OR for external media with thumbnailUrl */}
                    {thumbnailUrl && (isImage || item.type === 'external') ? (
                      <Image
                        src={thumbnailUrl}
                        alt={item.alt || item.filename || 'Media'}
                        width={40}
                        height={40}
                        className="inline-rich-text-media-thumb"
                      />
                    ) : (
                      <div className="inline-rich-text-media-icon">
                        <ImageIcon size={16} />
                      </div>
                    )}
                    <span className="inline-rich-text-media-name">{item.filename}</span>
                    <button
                      type="button"
                      className="inline-rich-text-media-remove"
                      onClick={() => handleRemoveMedia(item.id)}
                      title="Remove media"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="inline-rich-text-footer">
        {value.value.length} characters{!isEditMode ? ' · preview' : ''}
      </div>

      <ListDrawer onSelect={handleDrawerSelect} />
    </div>
  )
}
