'use client'

import React from 'react'
import { Plus } from 'lucide-react'
import type {
  EquationMode,
  EquationStep,
  LinearEquation,
  QuestionEquationBlock,
} from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'
import { linearToSides } from '@/server/payload/collections/Exercises/linearEquation'
import { EquationSidesFields } from '../components/equation/EquationSidesFields'
import { EquationStepEditor } from '../components/equation/EquationStepEditor'
import { LinearEquationFields } from '../components/equation/LinearEquationFields'
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

const DEFAULT_LINEAR: LinearEquation = { a: 2, b: 3, c: 1, d: 8 }

const MODE_OPTIONS: Array<{ value: EquationMode; label: string; help: string }> = [
  { value: 'steps', label: 'Fixed steps', help: 'You write every step, its options and result.' },
  {
    value: 'dynamic',
    label: 'Dynamic',
    help: 'Options are generated after every choice until x is isolated, then checked by substitution.',
  },
]

export const EquationEditor: React.FC<EquationEditorProps> = ({ block, onChange }) => {
  const updateStep = (step: EquationStep) => {
    onChange({ ...block, steps: block.steps.map((s) => (s.id === step.id ? step : s)) })
  }

  const deleteStep = (stepId: string) => {
    onChange({ ...block, steps: block.steps.filter((s) => s.id !== stepId) })
  }

  const mode: EquationMode = block.mode ?? 'steps'

  const setLinear = (linear: LinearEquation) => {
    onChange({ ...block, linear, equation: linearToSides(linear) })
  }

  const setMode = (next: EquationMode) => {
    if (next === 'dynamic') {
      const linear = block.linear ?? DEFAULT_LINEAR
      onChange({ ...block, mode: next, linear, equation: linearToSides(linear) })
      return
    }
    const steps = block.steps.length ? block.steps : [createStep()]
    onChange({ ...block, mode: next, steps })
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
        <label className="question-editor-label">Mode</label>
        <div role="radiogroup" className="flex flex-col gap-content-gap-xs">
          {MODE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-content-gap-xs">
              <input
                type="radio"
                name={`equation-mode-${block.id}`}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
              />
              <span>
                <strong>{option.label}</strong> — {option.help}
              </span>
            </label>
          ))}
        </div>
      </div>

      {mode === 'dynamic' ? (
        <div className="question-editor-section">
          <label className="question-editor-label">Equation (whole numbers)</label>
          <LinearEquationFields value={block.linear ?? DEFAULT_LINEAR} onChange={setLinear} />
        </div>
      ) : (
        <>
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
        </>
      )}

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
