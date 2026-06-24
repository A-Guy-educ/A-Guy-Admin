'use client'

import Link from 'next/link'
import React from 'react'

export const StatisticsSidebarLink: React.FC = () => {
  return (
    <li className="nav__item">
      <Link href="/admin/statistics" className="nav__link">
        <span className="nav__label">Statistics</span>
      </Link>
    </li>
  )
}

export default StatisticsSidebarLink
