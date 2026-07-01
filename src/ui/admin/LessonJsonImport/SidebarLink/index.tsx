'use client'

import Link from 'next/link'
import React from 'react'

export const LessonJsonImportSidebarLink: React.FC = () => {
  return (
    <li className="nav__item">
      <Link href="/admin/lesson-json-import" className="nav__link">
        <span className="nav__label">Lesson Import</span>
      </Link>
    </li>
  )
}

export default LessonJsonImportSidebarLink
