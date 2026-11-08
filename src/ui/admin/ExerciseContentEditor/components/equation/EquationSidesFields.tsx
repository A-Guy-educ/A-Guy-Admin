'use client'

import React from 'react'
import type { EquationSides } from '@/server/payload/collections/Exercises/types'

interface EquationSidesFieldsProps {
  value: EquationSides
  onChange: (value: EquationSides) => void
}

export const EquationSidesFields: React.FC<EquationSidesFieldsProps> = ({ value, onChange }) => (
  <div dir="ltr" className="flex items-center gap-content-gap-xs">
    <input
      type="text"
      className="accepted-answer-input"
      aria-label="Left side (LaTeX)"
      placeholder="2x + 3"
      value={value.left}
      onChange={(e) => onChange({ ...value, left: e.target.value })}
    />
    <span aria-hidden="true">=</span>
    <input
      type="text"
      className="accepted-answer-input"
      aria-label="Right side (LaTeX)"
      placeholder="x + 8"
      value={value.right}
      onChange={(e) => onChange({ ...value, right: e.target.value })}
    />
  </div>
)
