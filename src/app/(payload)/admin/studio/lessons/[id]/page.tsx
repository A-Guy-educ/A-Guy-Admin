'use client'

import { useParams } from 'next/navigation'
import { useCurrentUser } from '@/client/hooks/useCurrentUser'
import { LessonStudioPage } from '@/ui/admin/LessonStudio/LessonStudioPage'

const messageStyle: React.CSSProperties = {
  padding: 20,
  color: 'var(--theme-elevation-500)',
  fontSize: 13,
}

const errorStyle: React.CSSProperties = {
  padding: 20,
  color: 'var(--theme-error-500)',
  fontSize: 13,
}

export default function StudioLessonPage() {
  const params = useParams<{ id: string }>()
  const { user, isLoading } = useCurrentUser()

  const lessonId = typeof params?.id === 'string' ? params.id : null

  if (isLoading) return <div style={messageStyle}>Loading…</div>
  if (!user) return <div style={errorStyle}>Please log in to use the Studio</div>

  const isAdmin = Array.isArray(user.role) ? user.role.includes('admin') : user.role === 'admin'
  if (!isAdmin) return <div style={errorStyle}>Admin access required</div>

  if (!lessonId) return <div style={errorStyle}>Missing lesson id in URL</div>

  return <LessonStudioPage lessonId={lessonId} />
}
