'use client'

import React from 'react'
import { Trash2, ArrowUp, ArrowDown, Type } from 'lucide-react'
import { RichTextEditor } from './RichTextEditor'

interface BlockCardProps {
  block: any
  index: number
  total: number
  onChange: (updates: any) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export const BlockCard: React.FC<BlockCardProps> = ({
  block,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}) => {
  return (
    <div className="block-card">
      <div className="block-card-header">
        <div className="block-card-title">
          <Type size={14} />
          Rich Text
        </div>

        <div className="block-card-actions">
          <button onClick={onMoveUp} disabled={index === 0} className="icon-button" title="Move Up">
            <ArrowUp size={14} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="icon-button"
            title="Move Down"
          >
            <ArrowDown size={14} />
          </button>
          <button onClick={onDelete} className="icon-button delete" title="Delete Block">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="block-card-content">
        <RichTextEditor
          value={block.value || ''}
          onChange={(val) => onChange({ ...block, value: val })}
        />
      </div>
    </div>
  )
}
