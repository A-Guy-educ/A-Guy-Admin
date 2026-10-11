'use client'

import React from 'react'

interface NotebookToggleProps {
  value: boolean
  onChange: (value: boolean) => void
}

export const NotebookToggle: React.FC<NotebookToggleProps> = ({ value, onChange }) => (
  <div className="hint-solution-notebook-toggle">
    <label className="hint-solution-notebook-label">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>Show drawing notebook (הצג מחברת ציור)</span>
    </label>
    <p className="hint-solution-notebook-help">
      When on, students see an &quot;Open notebook&quot; pill under this block to sketch work and
      ask the tutor to check it.
    </p>
  </div>
)
