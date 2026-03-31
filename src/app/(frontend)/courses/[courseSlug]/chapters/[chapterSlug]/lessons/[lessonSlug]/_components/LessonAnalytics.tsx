'use client'

import { consumeLessonOpenTimestamp } from '@/infra/analytics/utils/lesson-load-timing'
import { SYSTEM_EVENTS, systemEventBus } from '@/infra/system-events'
import { useSetCurrentLesson } from '@/client/providers/ActiveTimeProvider'
import { useEffect, useRef } from 'react'

/** Timeout threshold (ms) after which we consider the lesson "never loaded" */
const LOAD_TIMEOUT_MS = 30_000

export type LessonContentType = 'pdf' | 'exercises' | 'blocks'

interface LessonAnalyticsProps {
  lessonId: string
  courseId: string
  lessonTitle: string
  contentType: LessonContentType
}

export function LessonAnalytics({
  lessonId,
  courseId,
  lessonTitle,
  contentType,
}: LessonAnalyticsProps) {
  const startTimeRef = useRef<number>(Date.now())
  const hasEmittedEndedRef = useRef<boolean>(false)

  // Register current lesson for per-lesson time tracking
  useSetCurrentLesson(lessonId)

  useEffect(() => {
    // Track lesson started
    startTimeRef.current = Date.now()
    hasEmittedEndedRef.current = false

    systemEventBus.emit(SYSTEM_EVENTS.LESSON_STARTED, {
      lesson_id: lessonId,
      course_id: courseId,
      lesson_title: lessonTitle,
    })

    // Track lesson load success — calculate time since user clicked the link
    const clickTimestamp = consumeLessonOpenTimestamp(lessonId)
    const loadTimeMs = clickTimestamp ? Date.now() - clickTimestamp : 0

    systemEventBus.emit(SYSTEM_EVENTS.LESSON_LOAD_SUCCESS, {
      lesson_id: lessonId,
      content_type: contentType,
      load_time_ms: loadTimeMs,
      course_id: courseId,
    })

    // Track lesson ended on unmount (when user navigates away)
    return () => {
      // Prevent double emission in Strict Mode or rapid re-renders
      if (hasEmittedEndedRef.current) {
        return
      }
      hasEmittedEndedRef.current = true

      const durationSeconds = Math.floor((Date.now() - startTimeRef.current) / 1000)
      systemEventBus.emit(SYSTEM_EVENTS.LESSON_ENDED, {
        lesson_id: lessonId,
        course_id: courseId,
        duration_seconds: durationSeconds,
      })
    }
  }, [lessonId, courseId, lessonTitle, contentType])

  return null
}

/**
 * Wrapper that tracks lesson load timeout.
 * Place this alongside LessonAnalytics — if the lesson page takes too long
 * (e.g., PDF never loads, JS error prevents render), this fires LESSON_LOAD_FAILED.
 *
 * The timeout is cancelled if the component mounts (meaning the page rendered).
 * For pages that render but have content that fails to load (e.g., PDF 404),
 * the PDFMedia component handles that case separately.
 */
export function LessonLoadTimeoutTracker({
  lessonId,
  courseId,
  contentType,
}: {
  lessonId: string
  courseId: string
  contentType: LessonContentType
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      systemEventBus.emit(SYSTEM_EVENTS.LESSON_LOAD_FAILED, {
        lesson_id: lessonId,
        content_type: contentType,
        error_type: 'timeout' as const,
        error_message: `Content did not render within ${LOAD_TIMEOUT_MS}ms`,
        course_id: courseId,
      })
    }, LOAD_TIMEOUT_MS)

    // If the component mounts successfully, cancel the timeout
    // The success event is already tracked by LessonAnalytics
    return () => clearTimeout(timer)
  }, [lessonId, courseId, contentType])

  return null
}
