'use client'

import React, { useEffect, useState } from 'react'
import { SKETCH_HEIGHT_PX } from '@/infra/utils/graphics/board-sizing'
import { formatAspectRatio } from '@/infra/utils/graphics/geometry-canvas-size'

const MIN_WIDTH = 100
const MAX_WIDTH = 2000

interface CanvasWidthFieldProps {
  /** Width derived from the bounding box (330 × ratio), not the stored width. */
  width: number
  /** Called only when the author commits a new width (blur / Enter). */
  onCommit: (width: number) => void
}

/**
 * Width input + fixed 330 height + resulting ratio. The width is a draft
 * until blur/Enter: committing per keystroke would apply "3", then "33", then
 * "330" to the box, and since a width change only ever grows the box, the
 * intermediate values would leave huge padding behind.
 */
export const CanvasWidthField: React.FC<CanvasWidthFieldProps> = ({ width, onCommit }) => {
  const [draft, setDraft] = useState(String(width))

  useEffect(() => setDraft(String(width)), [width])

  const commit = () => {
    const next = Number(draft)
    if (!Number.isFinite(next) || next <= 0) {
      setDraft(String(width))
      return
    }
    const clamped = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)))
    setDraft(String(clamped))
    if (clamped !== width) onCommit(clamped)
  }

  return (
    <>
      <div className="panel-field">
        <span className="panel-field-label">Width</span>
        <input
          type="number"
          className="panel-field-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          min={MIN_WIDTH}
          max={MAX_WIDTH}
        />
      </div>
      <div className="panel-field">
        <span className="panel-field-label">Height</span>
        <input
          type="number"
          className="panel-field-input"
          value={SKETCH_HEIGHT_PX}
          readOnly
          disabled
          title="Sketches always render 330px tall; the width sets the ratio."
        />
      </div>
      <div className="panel-field">
        <span className="panel-field-label">Ratio</span>
        <span className="canvas-config-ratio">{formatAspectRatio(width / SKETCH_HEIGHT_PX)}</span>
      </div>
    </>
  )
}
