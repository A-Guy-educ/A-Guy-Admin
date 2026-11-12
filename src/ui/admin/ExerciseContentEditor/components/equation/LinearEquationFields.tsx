'use client'

import React, { useState } from 'react'
import type { LinearEquation } from '@/server/payload/collections/Exercises/types'
import {
  isSolvableLinear,
  linearToSides,
} from '@/server/payload/collections/Exercises/linearEquation'
import { MathMarkdown } from '@/ui/shared/primitives/MathMarkdown'

interface LinearEquationFieldsProps {
  value: LinearEquation
  onChange: (value: LinearEquation) => void
}

interface CoefficientInputProps {
  label: string
  value: number
  onChange: (value: number) => void
}

/** Keeps the raw text so "-" can be typed before the digits. */
const CoefficientInput: React.FC<CoefficientInputProps> = ({ label, value, onChange }) => {
  const [text, setText] = useState(String(value))
  return (
    <input
      type="text"
      inputMode="numeric"
      className="accepted-answer-input w-20 text-center"
      aria-label={label}
      value={text}
      onChange={(e) => {
        const next = e.target.value.trim()
        setText(next)
        if (/^-?\d+$/.test(next)) onChange(Number(next))
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

/** Integer coefficients of `a·x + b = c·x + d` with a live preview. */
export const LinearEquationFields: React.FC<LinearEquationFieldsProps> = ({ value, onChange }) => {
  const sides = linearToSides(value)
  const field = (key: keyof LinearEquation, label: string) => (
    <CoefficientInput
      label={label}
      value={value[key]}
      onChange={(n) => onChange({ ...value, [key]: n })}
    />
  )
  return (
    <div className="flex flex-col gap-content-gap-xs">
      <div dir="ltr" className="flex flex-wrap items-center gap-content-gap-xs">
        {field('a', 'Left x coefficient')}
        <span>x +</span>
        {field('b', 'Left constant')}
        <span aria-hidden="true">=</span>
        {field('c', 'Right x coefficient')}
        <span>x +</span>
        {field('d', 'Right constant')}
      </div>
      <div dir="ltr">
        <MathMarkdown content={`$${sides.left} = ${sides.right}$`} />
      </div>
      {!isSolvableLinear(value) && (
        <span className="viewport-validation-error">
          Needs exactly one solution (left and right x coefficients must differ) and must not
          already be solved.
        </span>
      )}
    </div>
  )
}
