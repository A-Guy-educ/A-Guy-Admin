'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getUserProfile } from '@/lib/localStorage/userProfile'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/providers/I18n'
import type { Course } from '@/payload-types'

export function StudyContent() {
  const t = useTranslations('study')
  const router = useRouter()
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      const profile = getUserProfile()
      if (!profile?.gradeLevel) {
        window.location.href = '/'
        return
      }

      try {
        // Load courses
        const coursesResponse = await fetch('/api/courses')
        if (coursesResponse.ok) {
          const coursesData = await coursesResponse.json()
          setCourses(coursesData.docs || [])
        }
      } catch (error) {
        console.error('Failed to load courses:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  const handleCourseClick = (course: Course) => {
    if (course.slug) {
      router.push(`/courses/${course.slug}`)
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-muted-foreground">{t('loading')}</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">{t('chooseCourse')}</h1>
      {courses.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-12">
          {courses.map((course) => (
          <Card
            key={course.id}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleCourseClick(course)
            }}
            className="cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
          >
            <CardHeader>
              {course.courseLabel && (
                <Badge variant="secondary" className="w-fit mb-2 text-xs font-semibold">
                  {course.courseLabel}
                </Badge>
              )}
              <CardTitle className="text-lg font-bold">{course.title}</CardTitle>
            </CardHeader>
            {course.description && (
              <CardContent>
                <CardDescription className="line-clamp-2">{course.description}</CardDescription>
              </CardContent>
            )}
          </Card>
          ))}
        </div>
      )}
      {courses.length === 0 && (
        <div className="text-center text-muted-foreground py-12">{t('noCoursesAvailable')}</div>
      )}
    </div>
  )
}
