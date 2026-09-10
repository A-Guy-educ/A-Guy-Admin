'use client'

import React from 'react'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import { getDefaultCanvasElementColor } from '@/infra/contracts/graphics/textColors'
import { Plus, Trash2 } from 'lucide-react'
import { ColorSwatchPicker } from '../shared/ColorSwatchPicker'
import { CompassPositionPicker } from '../shared/CompassPositionPicker'

type AxisPoint = AxisSpecV1['elements']['points'][number]

interface AxisPointsPanelProps {
  points: AxisPoint[]
  onChange: (points: AxisPoint[]) => void
}

const DEFAULT_POINT_SIZE = 4
const DEFAULT_LABEL_POSITION = 'tr' as const

export const AxisPointsPanel: React.FC<AxisPointsPanelProps> = ({ points, onChange }) => {
  const handleAdd = () => {
    const newPoint: AxisPoint = {
      x: 0,
      y: 0,
      type: 'point',
      size: DEFAULT_POINT_SIZE,
      labelPosition: DEFAULT_LABEL_POSITION,
    }
    onChange([...points, newPoint])
  }

  const handleRemove = (index: number) => {
    onChange(points.filter((_, i) => i !== index))
  }

  const handleUpdate = (index: number, updates: Partial<AxisPoint>) => {
    onChange(points.map((p, i) => (i === index ? { ...p, ...updates } : p)))
  }

  return (
    <div className="axis-points-panel">
      <div className="panel-items-list">
        {points.map((point, index) => (
          <div key={index} className="panel-item-row" style={{ flexWrap: 'wrap' }}>
            <div className="panel-field">
              <span className="panel-field-label">X</span>
              <input
                type="number"
                className="panel-field-input"
                value={point.x}
                onChange={(e) => handleUpdate(index, { x: Number(e.target.value) })}
              />
            </div>
            <div className="panel-field">
              <span className="panel-field-label">Y</span>
              <input
                type="number"
                className="panel-field-input"
                value={point.y}
                onChange={(e) => handleUpdate(index, { y: Number(e.target.value) })}
              />
            </div>
            <div className="panel-field">
              <span className="panel-field-label">Type</span>
              <select
                className="panel-field-select"
                value={point.type}
                onChange={(e) => handleUpdate(index, { type: e.target.value as AxisPoint['type'] })}
              >
                <option value="point">Point</option>
                <option value="hole">Hole</option>
                <option value="floating_text">Text</option>
              </select>
            </div>
            <div className="panel-field">
              <span className="panel-field-label">Label</span>
              <input
                type="text"
                className="panel-field-input"
                value={point.label || ''}
                style={{ width: 60 }}
                onChange={(e) => handleUpdate(index, { label: e.target.value || undefined })}
              />
            </div>
            {point.type !== 'floating_text' && (
              <div className="panel-field">
                <span className="panel-field-label">Size (1-10)</span>
                <input
                  type="number"
                  className="panel-field-input"
                  min={1}
                  max={10}
                  step={1}
                  value={point.size ?? DEFAULT_POINT_SIZE}
                  onChange={(e) => {
                    const raw = parseInt(e.target.value, 10)
                    handleUpdate(index, {
                      size: isNaN(raw) ? DEFAULT_POINT_SIZE : Math.max(1, Math.min(10, raw)),
                    })
                  }}
                />
              </div>
            )}
            <div className="panel-field">
              <span className="panel-field-label">Color</span>
              <ColorSwatchPicker
                value={point.color}
                onChange={(hex) => handleUpdate(index, { color: hex })}
                defaultHex={getDefaultCanvasElementColor()}
                label="Point color"
              />
            </div>
            {point.label && point.type !== 'floating_text' && (
              <div className="panel-field">
                <span className="panel-field-label">Label pos</span>
                <CompassPositionPicker
                  value={
                    point.labelPosition && point.labelPosition !== 'm' && point.labelPosition !== 'middle'
                      ? point.labelPosition
                      : undefined
                  }
                  defaultValue={DEFAULT_LABEL_POSITION}
                  onChange={(pos) => handleUpdate(index, { labelPosition: pos })}
                />
              </div>
            )}
            <button type="button" className="panel-remove-btn" onClick={() => handleRemove(index)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="panel-add-btn" onClick={handleAdd}>
        <Plus size={14} />
        <span>Add Point</span>
      </button>
    </div>
  )
}
