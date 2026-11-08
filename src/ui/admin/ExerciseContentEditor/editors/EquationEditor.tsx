'use client'

import React from 'react'
import { Plus } from 'lucide-react'
import type {
  EquationStep,
  QuestionEquationBlock,
} from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'
import { EquationSidesFields } from '../components/equation/EquationSidesFields'
import { EquationStepEditor } from '../components/equation/EquationStepEditor'
import { InlineRichTextEditor } from './InlineRichTextEditor'
import { HintSolutionPanel } from './HintSolutionPanel'
import { NotebookToggle } from './NotebookToggle'

interface EquationEditorProps {
  block: QuestionEquationBlock
  onChange: (block: QuestionEquationBlock) => void
}

function createStep(): EquationStep {
  const options = [
    { id: generateId(), label: '' },
    { id: generateId(), label: '' },
  ]
  return {
    id: generateId(),
    options,
    correctOptionId: options[0].id,
    result: { left: '', right: '' },
  }
}

export const EquationEditor: React.FC<EquationEditorProps> = ({ block, onChange }) => {
  const updateStep = (step: EquationStep) => {
    onChange({ ...block, steps: block.steps.map((s) => (s.id === step.id ? step : s)) })
  }

  const deleteStep = (stepId: string) => {
    onChange({ ...block, steps: block.steps.filter((s) => s.id !== stepId) })
  }

  return (
    <div className="equation-editor">
      <div className="question-editor-section">
        <label className="question-editor-label">Prompt (optional)</label>
        <InlineRichTextEditor
          value={block.prompt}
          onChange={(prompt) => onChange({ ...block, prompt })}
          placeholder="Solve the equation..."
        />
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Equation (LaTeX, without $)</label>
        <EquationSidesFields
          value={block.equation}
          onChange={(equation) => onChange({ ...block, equation })}
        />
      </div>

      {block.steps.map((step, index) => (
        <EquationStepEditor
          key={step.id}
          step={step}
          index={index}
          canDelete={block.steps.length > 1}
          onChange={updateStep}
          onDelete={() => deleteStep(step.id)}
        />
      ))}

      <div className="question-editor-section">
        <button
          type="button"
          className="mcq-add-option-btn"
          onClick={() => onChange({ ...block, steps: [...block.steps, createStep()] })}
        >
          <Plus size={14} /> Add step
        </button>
      </div>

      <div className="question-editor-section">
        <NotebookToggle
          value={block.showNotebook ?? false}
          onChange={(value) => onChange({ ...block, showNotebook: value })}
        />
      </div>

      <div className="question-editor-section">
        <HintSolutionPanel
          hint={block.hint}
          solution={block.solution}
          fullSolution={block.fullSolution}
          blockId={block.id}
          onChange={(field, value) => onChange({ ...block, [field]: value })}
          onBatchChange={(fields) => onChange({ ...block, ...fields })}
        />
      </div>
    </div>
  )
}
