'use client'

import { SystemLink } from '@/infra/loading/components/SystemLink'
import { cn } from '@/infra/utils/ui'
import type { Lesson } from '@/payload-types'
import { useTranslations } from '@/ui/web/providers/I18n'
import { ContentStatusBadge } from '@/ui/web/shared/ContentStatusBadge'
import { ProgressCircle } from '@/ui/web/shared/ProgressCircle'
import { BookOpen, FileText, Target, Trophy } from 'lucide-react'
import { toast } from 'sonner'

interface CourseLessonCardProps {
  lesson: Lesson
  index: number
  courseSlug: string
  chapterSlug: string
  tabColor?: { text: string; stroke: string }
  progress?: number
}

export function CourseLessonCard({
  lesson,
  index,
  courseSlug,
  chapterSlug,
  tabColor,
  progress = 0,
}: CourseLessonCardProps) {
  const tc = useTranslations('courses')

  const href = `/courses/${courseSlug}/chapters/${chapterSlug}/lessons/${lesson.slug}`
  const isSoon = lesson.contentStatus === 'soon'
  const accentColor = isSoon ? 'var(--border)' : (tabColor?.stroke ?? 'hsl(var(--primary))')

  const handleLessonClick = (e: React.MouseEvent) => {
    if (isSoon) {
      e.preventDefault()
      toast.info(tc('contentLocked'))
    }
  }

  const TypeIcon = lesson.type === 'practice' ? Target : lesson.type === 'exam' ? Trophy : BookOpen
  const hasFiles = (lesson.contentFiles?.length ?? 0) > 0

  return (
    <div
      className={cn(
        'relative group rounded-xl bg-card border border-border/30 transition-all duration-normal will-change-transform',
        !isSoon && 'hover:border-border/50 active:scale-[0.98]',
        isSoon && 'opacity-50',
      )}
      style={{
        borderInlineStartWidth: '3px',
        borderInlineStartColor: accentColor,
      }}
    >
      <ContentStatusBadge
        contentStatus={lesson.contentStatus}
        contentStatusExpiresAt={lesson.contentStatusExpiresAt ?? undefined}
        contentStatusLabel={lesson.contentStatusLabel ?? undefined}
        className="absolute -top-2.5 end-3 z-10"
      />
      <SystemLink
        href={isSoon ? '#' : href}
        onClick={handleLessonClick}
        className={cn(
          'p-5 flex items-center gap-4',
          isSoon ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        {/* Lesson icon */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${accentColor.replace(')', ' / 0.15)')}` }}
        >
          <TypeIcon className="w-5 h-5" style={{ color: accentColor }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-body-xs font-medium text-muted-foreground">
              {tc('lesson')} {index}
            </span>
            {hasFiles && (
              <FileText className="w-3 h-3 text-muted-foreground/50" />
            )}
          </div>
          <h3 className="text-body-lg font-semibold text-card-foreground truncate">{lesson.title}</h3>
          {lesson.description && (
            <p className="text-body-xs text-muted-foreground mt-1 line-clamp-1 [&_p]:inline">
              {lesson.description.replace(/<[^>]*>/g, '')}
            </p>
          )}
        </div>

        {/* Progress */}
        <div className="shrink-0">
          <ProgressCircle
            percentage={progress}
            size={40}
            strokeWidth={3}
            strokeColor={accentColor}
          >
            {progress > 0 ? (
              <text
                x="50%"
                y="50%"
                textAnchor="middle"
                dy=".3em"
                className="text-[10px] font-bold fill-foreground"
              >
                {Math.round(progress)}%
              </text>
            ) : null}
          </ProgressCircle>
        </div>
      </SystemLink>
    </div>
  )
}
