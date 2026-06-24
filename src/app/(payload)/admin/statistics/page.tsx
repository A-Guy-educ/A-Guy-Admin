'use client'

import React from 'react'

import { useCurrentUser } from '@/client/hooks/useCurrentUser'
import DashboardWidgets from '@/ui/admin/ConversionTracking/DashboardWidgets'

const loadingStyle: React.CSSProperties = {
  padding: 20,
  color: 'var(--theme-elevation-500)',
  fontSize: 13,
}

const errorStyle: React.CSSProperties = {
  padding: 20,
  color: 'var(--theme-error)',
  fontSize: 13,
}

export default function AdminStatisticsPage() {
  const { user, isLoading } = useCurrentUser()

  if (isLoading) {
    return <div style={loadingStyle}>Loading...</div>
  }

  if (!user) {
    return <div style={errorStyle}>Please log in to view statistics</div>
  }

  const isAdmin = Array.isArray(user.role) ? user.role.includes('admin') : user.role === 'admin'

  if (!isAdmin) {
    return <div style={errorStyle}>Admin access required</div>
  }

  return <DashboardWidgets />
}
