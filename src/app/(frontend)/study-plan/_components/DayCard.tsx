'use client'

import { useState } from 'react'

import type { StudyPlanDay, TopicInput } from '@/lib/study-plan'
import { useTranslations } from '@/ui/web/providers/I18n'
import { CheckCircle2, Clock, Edit2 } from 'lucide-react'

const ACTIVITY_COLORS = {
  practice: 'bg-blue-100 text-blue-800 border-blue-200',
  hybrid: 'bg-purple-100 text-purple-800 border-purple-200',
  full_simulation: 'bg-rose-100 text-rose-800 border-rose-200',
  reinforcement: 'bg-green-100 text-green-800 border-green-200',
  warmup: 'bg-amber-100 text-amber-800 border-amber-200',
} as const

interface DayCardProps {
  day: StudyPlanDay
  topics: TopicInput[]
  onToggleStatus: () => void
  onEdit?: (edits: {
    userTopicIds?: string[]
    userDurationMinutes?: number
    userStartTime?: string
  }) => void
}

export function DayCard({ day, topics, onToggleStatus, onEdit }: DayCardProps) {
  const t = useTranslations('studyPlan')
  const [isEditing, setIsEditing] = useState(false)
  const [selectedTopics, setSelectedTopics] = useState<string[]>(day.userTopicIds || day.topicIds)
  const [duration, setDuration] = useState(day.userDurationMinutes || day.estimatedDurationMinutes)
  const [startTime, setStartTime] = useState(day.userStartTime || '')

  const isCompleted = day.status === 'completed'

  const handleSaveEdit = () => {
    if (onEdit) {
      onEdit({
        userTopicIds: selectedTopics,
        userDurationMinutes: duration,
        userStartTime: startTime || undefined,
      })
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    // Reset to current values
    setSelectedTopics(day.userTopicIds || day.topicIds)
    setDuration(day.userDurationMinutes || day.estimatedDurationMinutes)
    setStartTime(day.userStartTime || '')
    setIsEditing(false)
  }

  const toggleTopic = (topicId: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId],
    )
  }

  if (isEditing) {
    return (
      <div className="bg-white rounded-2xl border-2 border-blue-300 p-5 shadow-sm">
        <div className="flex items-start justify-between mb-3">
          <span className="text-sm font-semibold text-slate-500">
            {new Date(day.date).toLocaleDateString('he-IL', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <span
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
              ACTIVITY_COLORS[day.activityType]
            }`}
          >
            {t(`activity.${day.activityType}`)}
          </span>
        </div>

        {/* Topic selection */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-2">
            {t('topicsTitle')}
          </label>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {topics.map((topic) => (
              <button
                key={topic.topicId}
                type="button"
                onClick={() => toggleTopic(topic.topicId)}
                className={`px-2 py-0.5 text-xs font-medium rounded-md transition-colors ${
                  selectedTopics.includes(topic.topicId)
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {topic.topicLabel}
              </button>
            ))}
          </div>
        </div>

        {/* Duration input */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-2">
            {t('durationLabel')}
          </label>
          <input
            type="number"
            min="0"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        {/* Start time input */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-2">
            {t('startTimeLabel')}
          </label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSaveEdit}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
          >
            {t('saveEdit')}
          </button>
          <button
            onClick={handleCancelEdit}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            {t('cancelEdit')}
          </button>
        </div>
      </div>
    )
  }

  // Display mode
  return (
    <div
      className={`relative bg-white rounded-2xl border-2 p-5 transition-all ${
        isCompleted
          ? 'border-green-200 opacity-60'
          : 'border-slate-200 hover:border-slate-300 shadow-sm'
      }`}
    >
      {/* Edit button - only show when not completed */}
      {!isCompleted && onEdit && (
        <button
          onClick={() => setIsEditing(true)}
          className="absolute top-3 end-3 p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
          title={t('editDay')}
        >
          <Edit2 className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-slate-500">
            {new Date(day.date).toLocaleDateString('he-IL', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </span>
          {/* Show user override start time if set */}
          {day.userStartTime && (
            <span className="text-xs text-slate-400 ms-2">{day.userStartTime}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isCompleted && (
            <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4" />
              {t('completed')}
            </span>
          )}
          <span
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
              ACTIVITY_COLORS[day.activityType]
            }`}
          >
            {t(`activity.${day.activityType}`)}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex flex-wrap gap-1.5">
          {(day.userTopicIds || day.topicIds).map((id, idx) => {
            const label = topics.find((t) => t.topicId === id)?.topicLabel
            if (!label) return null
            return (
              <span
                key={idx}
                className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 rounded-md"
              >
                {label}
              </span>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-500">
          <Clock className="w-4 h-4" />
          <span className="text-sm">
            {day.userDurationMinutes || day.estimatedDurationMinutes} {t('minutesShort')}
          </span>
        </div>

        <button
          onClick={onToggleStatus}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            isCompleted
              ? 'text-slate-600 bg-slate-100 hover:bg-slate-200'
              : 'text-white bg-slate-900 hover:bg-slate-800'
          }`}
        >
          {isCompleted ? t('undoComplete') : t('markComplete')}
        </button>
      </div>
    </div>
  )
}
