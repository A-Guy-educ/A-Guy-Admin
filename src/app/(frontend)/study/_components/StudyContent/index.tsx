'use client'

import { useEffect, useState } from 'react'
import { getUserProfile, getLocalProgress } from '@/lib/localStorage/userProfile'
import { TopicCard } from '@/components/HomePage/TopicCard'
import type { Chapter } from '@/payload-types'

export function StudyContent() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [progressMap, setProgressMap] = useState<Record<string, number>>({})
  const [courseSlug, setCourseSlug] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      const profile = getUserProfile()
      if (!profile?.gradeLevel) {
        window.location.href = '/'
        return
      }

      try {
        const response = await fetch(`/api/chapters/by-grade?grade=${profile.gradeLevel}`)
        const data = await response.json()
        setChapters(data.chapters || [])
        setCourseSlug(data.courseSlug || '')

        const localProgress = getLocalProgress()
        const map: Record<string, number> = {}
        localProgress.forEach((record) => {
          if (record.recordType === 'chapter') {
            map[record.recordId] = record.completionPercentage
          }
        })
        setProgressMap(map)
      } catch (error) {
        console.error('Failed to load chapters:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-muted-foreground">טוען...</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">נושאי לימוד</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {chapters.map((chapter) => (
          <TopicCard
            key={chapter.id}
            chapter={chapter}
            progress={progressMap[chapter.id] || 0}
            courseSlug={courseSlug}
          />
        ))}
      </div>
      {chapters.length === 0 && (
        <div className="text-center text-muted-foreground py-12">אין נושאים זמינים לכיתה שלך</div>
      )}
    </div>
  )
}
