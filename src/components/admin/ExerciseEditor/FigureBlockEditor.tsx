'use client'

/**
 * Figure Block Editor
 */

import React, { useState, useEffect } from 'react'
import type { FigureBlock } from '@/contracts'
import type { BlockEditorProps } from '../shared/types'
import { ErrorDisplay } from '../shared/ErrorDisplay'
import { FigureRenderer } from '@/components/ExerciseRenderer/blocks/FigureRenderer'

export function FigureBlockEditor({
  block,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  errors,
}: BlockEditorProps<FigureBlock>) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [assets, setAssets] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const fetchAssets = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/exercise-assets?limit=50&depth=0')
      if (res.ok) {
        const data = await res.json()
        setAssets(data.docs)
      }
    } catch (e) {
      console.error('Failed to fetch assets', e)
    } finally {
      setLoading(false)
    }
  }

  const openPicker = () => {
    setIsPickerOpen(true)
    fetchAssets()
  }

  const selectAsset = (asset: any) => {
    onChange({
      ...block,
      assetId: asset.id,
      alt: asset.alt || block.alt, // specific precedence logic?
    })
    setIsPickerOpen(false)
  }

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: '4px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h4>Figure (Asset)</h4>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="btn btn--style-secondary btn--size-small"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="btn btn--style-secondary btn--size-small"
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="btn btn--style-secondary btn--size-small"
          >
            Delete
          </button>
        </div>
      </div>

      <ErrorDisplay errors={errors} />

      {/* Asset Selection */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {block.assetId ? (
            <div
              style={{
                flex: 1,
                padding: '0.5rem',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: '4px',
                background: 'var(--theme-elevation-50)',
              }}
            >
              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>ID: </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{block.assetId}</span>
            </div>
          ) : (
            <div style={{ flex: 1, color: 'var(--theme-error-500)', fontSize: '0.875rem' }}>
              No asset selected
            </div>
          )}
          <button
            type="button"
            onClick={openPicker}
            className="btn btn--style-primary btn--size-small"
          >
            {block.assetId ? 'Change Asset' : 'Select Asset'}
          </button>
        </div>
      </div>

      {isPickerOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setIsPickerOpen(false)}
        >
          <div
            style={{
              background: 'var(--theme-elevation-0)',
              width: '80%',
              maxWidth: '800px',
              height: '80%',
              borderRadius: '8px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3>Select Asset</h3>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="btn btn--style-secondary btn--size-small"
              >
                Close
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: '1rem',
              }}
            >
              {loading && <div>Loading assets...</div>}
              {!loading && assets.length === 0 && <div>No assets found</div>}
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => selectAsset(asset)}
                  style={{
                    border: '1px solid var(--theme-elevation-150)',
                    borderRadius: '4px',
                    padding: '0.5rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#f0f0f0',
                    }}
                  >
                    {asset.url && (
                      <img
                        src={asset.url}
                        alt={asset.alt}
                        style={{ maxWidth: '100%', maxHeight: '100%' }}
                      />
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', textAlign: 'center', wordBreak: 'break-all' }}>
                    {asset.filename}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fields */}
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
            Caption (Optional Override)
          </label>
          <input
            type="text"
            value={block.caption || ''}
            onChange={(e) => onChange({ ...block, caption: e.target.value })}
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid var(--theme-elevation-150)',
            }}
            placeholder="Caption..."
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
            Alt Text (Optional Override)
          </label>
          <input
            type="text"
            value={block.alt || ''}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid var(--theme-elevation-150)',
            }}
            placeholder="Alt text..."
          />
        </div>
      </div>

      {/* Preview */}
      <div
        style={{
          borderTop: '1px solid var(--theme-elevation-150)',
          paddingTop: '0.75rem',
          marginTop: '0.75rem',
        }}
      >
        <h4 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Rendered Preview</h4>
        <FigureRenderer block={block} />
      </div>
    </div>
  )
}
