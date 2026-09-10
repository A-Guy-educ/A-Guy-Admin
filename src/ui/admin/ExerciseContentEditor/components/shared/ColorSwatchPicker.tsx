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
 * Row of clickable color swatches drawn from the shared 8-color block palette.
 * Used everywhere authors pick a color inside a block editor (graph, geometry,
 * shapes, etc.) to keep the picker uniform across the studio.
 */
export const ColorSwatchPicker: React.FC<ColorSwatchPickerProps> = ({
  value,
  onChange,
  defaultHex,
  label,
}) => {
  const palette = getCanvasColorPalette()
  return (
    <div className="color-swatches-row" role="radiogroup" aria-label={label}>
      {palette.map((option) => {
        const isSelected = value === option.hex || (!value && option.hex === defaultHex)
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
