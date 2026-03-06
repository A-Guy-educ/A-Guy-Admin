/**
 * @fileType component
 * @domain cody
 * @pattern pipeline-progress
 * @ai-summary Compact inline pipeline progress indicator for task cards — shows stage dots, current stage label, and elapsed time
 */
'use client'

import { useState, useEffect } from 'react'
import { cn } from '../utils'
import type { CodyTask } from '../types'
import { ALL_STAGES } from '../constants'
import { calculatePipelineProgress, stageLabels, formatElapsed } from '../pipeline-utils'
import { Loader2, Timer } from 'lucide-react'

interface MiniPipelineProgressProps {
  task: CodyTask
  className?: string
}

/**
 * Compact pipeline progress for task list cards.
 * Shows:
 * - When pipeline data available: stage dots + current stage label + step X/Y
 * - When building but no pipeline: elapsed time + "Starting..." indicator
 * - When retrying: shows retry state
 */
export function MiniPipelineProgress({ task, className }: MiniPipelineProgressProps) {
  const [, setTick] = useState(0)
  const isActive = task.column === 'building' || task.column === 'retrying'

  // Tick every 5 seconds to keep elapsed time fresh for active tasks
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => setTick((t) => t + 1), 5000)
    return () => clearInterval(interval)
  }, [isActive])

  // Not a building/retrying task — don't show progress
  if (!isActive) return null

  const pipeline = task.pipeline
  const workflowRun = task.workflowRun

  // Case 1: Pipeline data available — show rich progress
  if (pipeline && pipeline.state === 'running' && pipeline.currentStage) {
    const progress = calculatePipelineProgress(pipeline)

    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        {/* Stage dots */}
        <div className="flex items-center gap-[2px]">
          {ALL_STAGES.map((stage, i) => {
            const isCompleted = progress.currentStageIndex > i
            const isCurrent = progress.currentStageIndex === i
            return (
              <div
                key={stage}
                className={cn(
                  'w-1.5 h-1.5 rounded-full transition-all',
                  isCompleted && 'bg-blue-500',
                  isCurrent && 'bg-blue-400 animate-pulse ring-1 ring-blue-400/50',
                  !isCompleted && !isCurrent && 'bg-zinc-600',
                )}
                title={stageLabels[stage] || stage}
              />
            )
          })}
        </div>

        {/* Current stage label */}
        <span className="text-[11px] text-blue-400 font-medium truncate max-w-24">
          {progress.currentStageLabel}
        </span>

        {/* Step counter */}
        <span className="text-[10px] text-zinc-500 font-mono">
          {progress.stepNumber}/{progress.totalStages}
        </span>

        {/* Elapsed time */}
        {pipeline.startedAt && (
          <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-0.5">
            <Timer className="w-2.5 h-2.5" />
            {formatElapsed(new Date(pipeline.startedAt))}
          </span>
        )}
      </div>
    )
  }

  // Case 2: Pipeline data available but not running (completed/failed stages visible)
  if (pipeline && pipeline.state !== 'running' && Object.keys(pipeline.stages || {}).length > 0) {
    const stages = pipeline.stages || {}
    const total = Object.keys(stages).length
    const completed = Object.values(stages).filter((s) => s.state === 'completed').length

    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        {/* Progress bar */}
        <div className="w-14 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full',
              pipeline.state === 'failed' ? 'bg-red-500' : 'bg-emerald-500',
            )}
            style={{ width: `${Math.round((completed / total) * 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-zinc-400 font-mono">
          {completed}/{total}
        </span>
        <span
          className={cn(
            'text-[10px] font-medium',
            pipeline.state === 'completed' && 'text-emerald-400',
            pipeline.state === 'failed' && 'text-red-400',
            pipeline.state === 'timeout' && 'text-orange-400',
          )}
        >
          {pipeline.state === 'completed' && '✓ done'}
          {pipeline.state === 'failed' && '✗ failed'}
          {pipeline.state === 'timeout' && '⏰ timeout'}
        </span>
      </div>
    )
  }

  // Case 3: No pipeline data but task is building — show "starting" state with elapsed
  if (isActive) {
    const startTime = workflowRun?.created_at || task.updatedAt
    const wfStatus = workflowRun?.status

    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
        <span className="text-[11px] text-blue-400/80">
          {wfStatus === 'in_progress'
            ? 'Pipeline running...'
            : wfStatus === 'queued'
              ? 'Queued...'
              : wfStatus === 'completed'
                ? 'Finishing up...'
                : 'Starting...'}
        </span>
        {startTime && (
          <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-0.5">
            <Timer className="w-2.5 h-2.5" />
            {formatElapsed(new Date(startTime))}
          </span>
        )}
      </div>
    )
  }

  return null
}
