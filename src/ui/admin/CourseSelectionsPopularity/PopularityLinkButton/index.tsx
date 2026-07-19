'use client'

import Link from 'next/link'
import React from 'react'

export const CourseSelectionsPopularityLinkButton: React.FC = () => {
  return (
    <Link
      href="/admin/course-selections/popularity"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 500,
        border: '1px solid var(--theme-success)',
        borderRadius: 4,
        backgroundColor: 'var(--theme-elevation-0)',
        color: 'var(--theme-success)',
        textDecoration: 'none',
        marginLeft: 8,
      }}
      title="Open the course-popularity report"
    >
      View popularity report →
    </Link>
  )
}

export default CourseSelectionsPopularityLinkButton
