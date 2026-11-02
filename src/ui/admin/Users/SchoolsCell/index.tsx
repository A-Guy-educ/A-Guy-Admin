'use client'

import type { DefaultCellComponentProps } from 'payload'
import React from 'react'

/** Renders the virtual `schools` (text hasMany) column as a comma list. */
export const UserSchoolsCell: React.FC<DefaultCellComponentProps> = ({ cellData }) => {
  const names = Array.isArray(cellData) ? cellData.filter((n) => typeof n === 'string') : []
  return <span>{names.length > 0 ? names.join(', ') : '—'}</span>
}

export default UserSchoolsCell
