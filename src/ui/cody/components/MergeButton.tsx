/**
 * @fileType component
 * @domain cody
 * @pattern merge-button
 * @ai-summary Merge button with CI status awareness - disabled until CI passes
 */
'use client'

import { Button } from '@/ui/web/components/button'
import { GitPullRequest, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { usePRCIStatus } from '../hooks/usePRCIStatus'
import { cn } from '../utils'

interface MergeButtonProps {
  prNumber: number
  isMerging: boolean
  onMerge: () => void
}

const ciIcons = {
  pending: { icon: Clock, color: 'text-yellow-400', title: 'CI pending…', spin: false },
  running: { icon: Loader2, color: 'text-blue-400', title: 'CI running…', spin: true },
  success: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    title: 'CI passed — ready to merge',
    spin: false,
  },
  failure: { icon: XCircle, color: 'text-red-400', title: 'CI failed', spin: false },
} as const
export function MergeButton({ prNumber, isMerging, onMerge }: MergeButtonProps) {
  const { data, isLoading } = usePRCIStatus(prNumber)

  const ciStatus = data?.ciStatus ?? 'pending'
  const canMerge = data?.mergeable ?? false
  const config = ciIcons[ciStatus]
  const CIIcon = config.icon

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isMerging || !canMerge || isLoading}
      title={isMerging ? 'Merging…' : config.title}
      onClick={(e) => {
        e.stopPropagation()
        onMerge()
      }}
      className={cn(
        'h-7 text-sm px-2 gap-1 disabled:opacity-50',
        canMerge
          ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/30 hover:border-emerald-500/50 hover:shadow-lg cursor-pointer'
          : 'text-muted-foreground bg-muted/30 cursor-not-allowed',
      )}
    >
      {isMerging ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <>
          <CIIcon className={cn('w-3.5 h-3.5', config.color, config.spin && 'animate-spin')} />
          <GitPullRequest className="w-4 h-4" />
        </>
      )}
    </Button>
  )
}
