'use client'

import React from 'react'
import { cssVarToHex } from '@/infra/contracts/graphics/textColors'
import type { PositionEnum } from '@/infra/contracts/primitives'

type CompassPos = Exclude<PositionEnum, 'm' | 'middle'>

const COMPASS_CELLS: ReadonlyArray<{ pos: CompassPos | null; arrow: string }> = [
  { pos: 'tl', arrow: '↖' },
  { pos: 't', arrow: '↑' },
  { pos: 'tr', arrow: '↗' },
  { pos: 'l', arrow: '←' },
  { pos: null, arrow: '' },
  { pos: 'r', arrow: '→' },
  { pos: 'bl', arrow: '↙' },
  { pos: 'b', arrow: '↓' },
  { pos: 'br', arrow: '↘' },
]

interface CompassPositionPickerProps {
  value?: CompassPos
  defaultValue?: CompassPos
  onChange: (position: CompassPos) => void
}

/**
 * 3x3 compass-direction picker for point label positions (N, NE, E, SE, ...).
 * Shared between the graph and geometry editors so authors have the same
 * control everywhere they set a label direction.
 */
export const CompassPositionPicker: React.FC<CompassPositionPickerProps> = ({
  value,
  defaultValue = 'r',
  onChange,
}) => {
  const active = value ?? defaultValue
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 20px)', gap: 2 }}
      role="radiogroup"
      aria-label="Label position"
    >
      {COMPASS_CELLS.map((cell, i) =>
        cell.pos ? (
          <button
            key={cell.pos}
            type="button"
            title={cell.pos}
            role="radio"
            aria-checked={active === cell.pos}
            onClick={() => onChange(cell.pos as CompassPos)}
            style={{
              width: 20,
              height: 20,
              padding: 0,
              fontSize: 11,
              border: `1px solid ${cssVarToHex('--border')}`,
              borderRadius: 3,
              cursor: 'pointer',
              background:
                active === cell.pos ? cssVarToHex('--primary') : cssVarToHex('--muted'),
              color:
                active === cell.pos
                  ? cssVarToHex('--primary-foreground')
                  : cssVarToHex('--foreground'),
            }}
          >
            {cell.arrow}
          </button>
        ) : (
          <span key={i} style={{ width: 20, height: 20 }} />
        ),
      )}
    </div>
  )
}
