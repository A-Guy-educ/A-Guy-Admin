'use client'

import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { EquationStep } from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'
import { EquationSidesFields } from './EquationSidesFields'

const MIN_OPTIONS = 2

interface EquationStepEditorProps {
  step: EquationStep
  index: number
  canDelete: boolean
  onChange: (step: EquationStep) => void
  onDelete: () => void
}

export const EquationStepEditor: React.FC<EquationStepEditorProps> = ({
  step,
  index,
  canDelete,
  onChange,
  onDelete,
}) => {
  const updateLabel = (optionId: string, label: string) => {
    onChange({
      ...step,
      options: step.options.map((o) => (o.id === optionId ? { ...o, label } : o)),
    })
  }

  const removeOption = (optionId: string) => {
    const options = step.options.filter((o) => o.id !== optionId)
    const correctOptionId = step.correctOptionId === optionId ? options[0].id : step.correctOptionId
    onChange({ ...step, options, correctOptionId })
  }

  const addOption = () => {
    onChange({ ...step, options: [...step.options, { id: generateId(), label: '' }] })
  }

  return (
    <div className="question-editor-section">
      <div className="flex items-center justify-between">
        <label className="question-editor-label">Step {index + 1}</label>
        <button
          type="button"
          className="mcq-option-action-btn mcq-option-action-btn--delete"
          onClick={onDelete}
          disabled={!canDelete}
          title="Delete step"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mcq-options-list">
        {step.options.map((option, optionIndex) => (
          <div key={option.id} className="mcq-option-row" dir="ltr">
            <div className="mcq-option-correct">
              <button
                type="button"
                className={`mcq-correct-marker ${step.correctOptionId === option.id ? 'mcq-correct-marker--checked' : ''}`}
                onClick={() => onChange({ ...step, correctOptionId: option.id })}
                title="Mark as the correct option"
              >
                <div className="mcq-correct-inner" />
              </button>
            </div>
            <div className="mcq-option-content">
              <input
                type="text"
                className="accepted-answer-input"
                aria-label={`Option ${optionIndex + 1} (LaTeX)`}
                placeholder="-3"
                value={option.label}
                onChange={(e) => updateLabel(option.id, e.target.value)}
              />
            </div>
            <div className="mcq-option-actions">
              <button
                type="button"
                className="mcq-option-action-btn mcq-option-action-btn--delete"
                onClick={() => removeOption(option.id)}
                disabled={step.options.length <= MIN_OPTIONS}
                title="Delete option"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mcq-add-option-btn" onClick={addOption}>
        <Plus size={14} /> Add option
      </button>

      <label className="question-editor-label">Result after the correct option</label>
      <EquationSidesFields
        value={step.result}
        onChange={(result) => onChange({ ...step, result })}
      />
    </div>
  )
}
