'use client'

import React, { useState } from 'react'

interface BulkPointSizeControlProps {
  min: number
  max: number
  initialSize: number
  onApply: (size: number) => void
  fieldLabel?: string
  applyLabel?: string
}

/** "Set all sizes" row shared by the geometry and axis points panels —
 *  used for both point size and label font size. */
export const BulkPointSizeControl: React.FC<BulkPointSizeControlProps> = ({
  min,
  max,
  initialSize,
  onApply,
  fieldLabel = 'All sizes',
  applyLabel = 'Apply to all points',
}) => {
  // Kept as a raw string and clamped on apply so multi-digit values whose
  // first digit is below `min` (e.g. "20" with min 8) can still be typed.
  const [draft, setDraft] = useState(String(initialSize))

  const handleApply = () => {
    const raw = parseInt(draft, 10)
    const size = isNaN(raw) ? initialSize : Math.max(min, Math.min(max, raw))
    setDraft(String(size))
    onApply(size)
  }

  return (
    <div className="panel-item-row">
      <div className="panel-field">
        <span className="panel-field-label">
          {fieldLabel} ({min}-{max})
        </span>
        <input
          type="number"
          className="panel-field-input"
          min={min}
          max={max}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <button type="button" className="panel-add-btn" onClick={handleApply}>
        <span>{applyLabel}</span>
      </button>
    </div>
  )
}
