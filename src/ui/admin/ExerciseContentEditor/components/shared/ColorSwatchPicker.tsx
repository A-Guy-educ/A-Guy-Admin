'use client'

import React from 'react'
import { getCanvasColorPalette } from '@/infra/contracts/graphics/textColors'

interface ColorSwatchPickerProps {
  /** Currently selected color hex, or undefined for the default */
  value?: string
  /** Called with the new hex when a swatch is clicked */
  onChange: (hex: string) => void
  /** Default hex used to highlight the "empty" swatch state */
  defaultHex?: string
  /** ARIA label / title prefix for accessibility */
  label?: string
}

/**
 * Normalize hex strings so `"#3366CC"`, `"#3366cc"`, and `"3366cc"` all
 * compare equal — palette values are stored lowercase-with-hash, but content
 * saved from earlier versions of the editor (or from LaTeX importers) may
 * carry other casings.
 */
function normalizeHex(hex?: string): string | undefined {
  if (!hex) return undefined
  const trimmed = hex.trim()
  if (!trimmed) return undefined
  return trimmed.startsWith('#') ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`
}

/**
 * Row of clickable color swatches drawn from the shared 8-color block palette.
 * Used everywhere authors pick a color inside a block editor (graph, geometry,
 * shapes, etc.) to keep the picker uniform across the studio.
 *
 * If the current `value` isn't one of the palette hexes (e.g. content saved
 * before the palette was consolidated, or a TikZ-imported color), it's shown
 * as an extra leading swatch marked with a dotted border, so the author can
 * see the current color and re-select it after clicking away — otherwise the
 * legacy color would be silently unrecoverable through the UI.
 */
export const ColorSwatchPicker: React.FC<ColorSwatchPickerProps> = ({
  value,
  onChange,
  defaultHex,
  label,
}) => {
  const palette = getCanvasColorPalette()
  const paletteHexes = new Set(palette.map((p) => normalizeHex(p.hex)))
  const normalizedValue = normalizeHex(value)
  const normalizedDefault = normalizeHex(defaultHex)
  const showLegacySwatch =
    !!normalizedValue && !paletteHexes.has(normalizedValue) && normalizedValue !== normalizedDefault
  return (
    <div className="color-swatches-row" role="radiogroup" aria-label={label}>
      {showLegacySwatch && value && (
        <button
          key={`legacy-${value}`}
          type="button"
          role="radio"
          aria-checked={true}
          className="color-swatch color-swatch--selected"
          style={{
            backgroundColor: value,
            border: '1px dashed rgba(0,0,0,0.4)',
          }}
          title={`Current: ${value} (not in palette)`}
          onClick={() => onChange(value)}
        />
      )}
      {palette.map((option) => {
        const optionHex = normalizeHex(option.hex)
        const isSelected =
          !showLegacySwatch &&
          (normalizedValue === optionHex || (!normalizedValue && optionHex === normalizedDefault))
        return (
          <button
            key={option.hex}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`color-swatch ${isSelected ? 'color-swatch--selected' : ''}`}
            style={{ backgroundColor: option.hex }}
            title={option.label}
            onClick={() => onChange(option.hex)}
          />
        )
      })}
    </div>
  )
}
