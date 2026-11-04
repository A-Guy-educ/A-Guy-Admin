'use client'

import React, { useEffect, useState } from 'react'

export const MIN_LABEL_SIZE = 8
export const MAX_LABEL_SIZE = 40

export const clampLabelSize = (raw: number, fallback: number): number =>
  isNaN(raw) ? fallback : Math.max(MIN_LABEL_SIZE, Math.min(MAX_LABEL_SIZE, Math.round(raw)))

interface LabelSizeInputProps {
  value: number | undefined
  defaultSize: number
  onChange: (fontSize: number) => void
}

/** Per-point label font size field. Clamps on blur/Enter rather than per
 *  keystroke so multi-digit values (e.g. "20") can be typed past the min. */
export const LabelSizeInput: React.FC<LabelSizeInputProps> = ({ value, defaultSize, onChange }) => {
  const current = value ?? defaultSize
  const [draft, setDraft] = useState(String(current))

  useEffect(() => setDraft(String(current)), [current])

  const commit = () => {
    const next = clampLabelSize(parseInt(draft, 10), current)
    setDraft(String(next))
    if (next !== current) onChange(next)
  }

  return (
    <div className="panel-field">
      <span className="panel-field-label">
        Label size ({MIN_LABEL_SIZE}-{MAX_LABEL_SIZE})
      </span>
      <input
        type="number"
        className="panel-field-input"
        min={MIN_LABEL_SIZE}
        max={MAX_LABEL_SIZE}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </div>
  )
}
