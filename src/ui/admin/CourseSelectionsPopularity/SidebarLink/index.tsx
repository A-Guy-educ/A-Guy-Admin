'use client'

import Link from 'next/link'
import React from 'react'

export const CourseSelectionsPopularitySidebarLink: React.FC = () => {
  return (
    <li className="nav__item">
      <Link href="/admin/course-selections/popularity" className="nav__link">
        <span className="nav__label">Course Popularity</span>
      </Link>
    </li>
  )
}

export default CourseSelectionsPopularitySidebarLink
