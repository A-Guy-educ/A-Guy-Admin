'use client'

import React, { useState } from 'react'

interface BulkPointSizeControlProps {
  min: number
  max: number
  initialSize: number
  onApply: (size: number) => void
}

/** "Set all point sizes" row shared by the geometry and axis points panels. */
export const BulkPointSizeControl: React.FC<BulkPointSizeControlProps> = ({
  min,
  max,
  initialSize,
  onApply,
}) => {
  const [size, setSize] = useState(initialSize)

  return (
    <div className="panel-item-row">
      <div className="panel-field">
        <span className="panel-field-label">
          All sizes ({min}-{max})
        </span>
        <input
          type="number"
          className="panel-field-input"
          min={min}
          max={max}
          step={1}
          value={size}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10)
            setSize(isNaN(raw) ? initialSize : Math.max(min, Math.min(max, raw)))
          }}
        />
      </div>
      <button type="button" className="panel-add-btn" onClick={() => onApply(size)}>
        <span>Apply to all points</span>
      </button>
    </div>
  )
}
