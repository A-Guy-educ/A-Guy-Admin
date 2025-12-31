'use client'

import React from 'react'
import { Plus } from 'lucide-react'
import { BlockCard } from './BlockCard'
import { generateId } from './utils'

interface BlockListProps {
  blocks: any[]
  onChange: (blocks: any[]) => void
}

export const BlockList: React.FC<BlockListProps> = ({ blocks, onChange }) => {
  const handleAdd = () => {
    const newBlock = {
      id: generateId(),
      type: 'rich_text',
      format: 'md-math-v1',
      value: '',
    }
    onChange([...blocks, newBlock])
  }

  const handleDelete = (index: number) => {
    const newBlocks = [...blocks]
    newBlocks.splice(index, 1)
    onChange(newBlocks)
  }

  const handleUpdate = (index: number, updatedBlock: any) => {
    const newBlocks = [...blocks]
    newBlocks[index] = updatedBlock
    onChange(newBlocks)
  }

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === blocks.length - 1) return

    const newBlocks = [...blocks]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    const [movedBlock] = newBlocks.splice(index, 1)
    newBlocks.splice(targetIndex, 0, movedBlock)
    onChange(newBlocks)
  }

  return (
    <div className="block-list">
      {blocks.map((block, index) => (
        <BlockCard
          key={block.id || index}
          block={block}
          index={index}
          total={blocks.length}
          onChange={(updated) => handleUpdate(index, updated)}
          onDelete={() => handleDelete(index)}
          onMoveUp={() => handleMove(index, 'up')}
          onMoveDown={() => handleMove(index, 'down')}
        />
      ))}

      <button onClick={handleAdd} className="add-block-button">
        <Plus size={16} />
        Add Content Block
      </button>
    </div>
  )
}
