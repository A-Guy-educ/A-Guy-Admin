'use client'

import Link from 'next/link'
import React from 'react'

export const ContentPromotionSidebarLink: React.FC = () => {
  return (
    <li className="nav__item">
      <Link href="/admin/content-promotion" className="nav__link">
        <span className="nav__label">Content Promotion</span>
      </Link>
    </li>
  )
}

export default ContentPromotionSidebarLink
