/**
 * @fileType plugin
 * @domain inspector
 * @pattern pipeline-fixer
 * @ai-summary Retry failed tasks, escalate persistent failures by creating fix-issues for Cody
 *
 * Flow:
 *   Retry 1-2: Simple rerun from failed stage with error as feedback
 *   Retry 3 (same error): Create a GitHub issue describing the failure, trigger @cody on it
 *   Retry 4-5: Rerun original task (now with potentially fixed pipeline code)
 *   Give up after 5 attempts
 */

import type {
  InspectorPlugin,
  ActionRequest,
  InspectorContext,
  EvaluatedTask,
} from '../../../core/types'
import { readTaskFile } from '../../../clients/github'
import { getQueueState } from '../queue-manager/queue-state'

// ============================================================================
// Types
// ============================================================================

interface FixerTaskState {
  retries: number
  errorSignature: string
  fixIssueNumber: number | null
  fixIssueCreatedAt: string | null
}

type FixerState = Record<string, FixerTaskState>

// ============================================================================
// Constants
// ============================================================================

const STATE_KEY = 'cody:fixerState'
const MAX_RETRIES = 5
const FIX_ISSUE_THRESHOLD = 2
const DEDUP_WINDOW_MINUTES = 15

// ============================================================================
// Helpers
// ============================================================================

function resolveFromStage(stage: string): string {
  if (stage === 'commit') return 'commit'
  if (stage === 'pr') return 'pr'
  if (stage === 'verify' || stage === 'autofix') return 'build'
  return stage
}

function errorSignature(stage: string, error: string): string {
  return `${stage}:${error.slice(0, 200).trim()}`
}

function isNonRetryable(error: string): boolean {
  const lower = error.toLowerCase()
  return (
    lower.includes('api key') ||
    lower.includes('_api_key') ||
    lower.includes('enospc') ||
    lower.includes('no space left') ||
    lower.includes('disk full')
  )
}

function getFixerState(ctx: InspectorContext): FixerState {
  return ctx.state.get<FixerState>(STATE_KEY) ?? {}
}

function getTaskState(state: FixerState, taskId: string): FixerTaskState {
  return (
    state[taskId] ?? {
      retries: 0,
      errorSignature: '',
      fixIssueNumber: null,
      fixIssueCreatedAt: null,
    }
  )
}

function saveFixerState(ctx: InspectorContext, state: FixerState): void {
  ctx.state.set(STATE_KEY, state)
}

function buildFixIssueBody(
  task: EvaluatedTask,
  taskState: FixerTaskState,
  issueBody: string,
): string {
  const failedStage = task.failedStage || 'unknown'
  const stageOutput = readTaskFile(task.taskId, `${failedStage}.md`).slice(0, 3000)
  const verifyOutput = readTaskFile(task.taskId, 'verify.md').slice(0, 3000)

  return `## Context

Task \`${task.taskId}\` (issue #${task.issueNumber}) has failed at the \`${failedStage}\` stage **${taskState.retries + 1} times** with the same error.

## Error

\`\`\`
${task.failedError || 'No error message available'}
\`\`\`

## Stage Output (\`${failedStage}.md\`)

${stageOutput || '_No stage output available (status.json may be on feature branch)_'}

## Verify Output

${verifyOutput || '_No verify output available_'}

## What Was Tried

${Array.from({ length: taskState.retries }, (_, i) => `- Retry ${i + 1}: rerun from \`${resolveFromStage(failedStage)}\` — same failure`).join('\n')}

## Original Issue (#${task.issueNumber})

${issueBody.slice(0, 2000)}

## Your Job

Analyze why Cody's pipeline keeps failing on this task and fix the pipeline code so it can handle this case. This could be:
- A prompt improvement in \`scripts/cody/\`
- A config change (timeouts, chunking, scoping)
- A bug fix in the pipeline code
- A new mechanism the pipeline needs

**Scope**: Only modify files in \`scripts/cody/\`. Do NOT fix the task's generated code.
**Target branch**: \`dev\`
`
}

// ============================================================================
// Action creators
// ============================================================================

function createRetryAction(
  task: EvaluatedTask,
  taskState: FixerTaskState,
  fixerState: FixerState,
): ActionRequest {
  const failedStage = task.failedStage || 'unknown'
  const fromStage = resolveFromStage(failedStage)
  const retryNum = taskState.retries + 1
  const fixRef = taskState.fixIssueNumber ? ` after fix issue #${taskState.fixIssueNumber}` : ''

  return {
    plugin: 'cody-pipeline-fixer',
    type: 'retry',
    target: task.taskId,
    urgency: 'critical',
    title: `Retry ${retryNum}/${MAX_RETRIES} for ${task.taskId}`,
    detail: `Retrying from ${fromStage}${fixRef}`,
    dedupKey: `pipeline-fixer:${task.taskId}`,
    dedupWindowMinutes: DEDUP_WINDOW_MINUTES,
    async execute(ctx: InspectorContext) {
      const feedback =
        readTaskFile(task.taskId, 'verify.md').slice(0, 2000) ||
        readTaskFile(task.taskId, `${failedStage}.md`).slice(0, 2000) ||
        task.failedError ||
        ''

      ctx.github.triggerWorkflow('cody.yml', {
        task_id: task.taskId,
        mode: 'rerun',
        from_stage: fromStage,
        feedback: feedback.slice(0, 2000),
      })

      ctx.github.postComment(
        task.issueNumber,
        `🔄 **[pipeline-fixer: retry ${retryNum}/${MAX_RETRIES}]** Retrying from \`${fromStage}\`${fixRef}`,
      )

      // Update state
      const newTaskState: FixerTaskState = {
        ...taskState,
        retries: retryNum,
        errorSignature: errorSignature(failedStage, task.failedError || ''),
      }
      fixerState[task.taskId] = newTaskState
      saveFixerState(ctx, fixerState)

      ctx.log.info({ taskId: task.taskId, retry: retryNum, fromStage }, 'Triggered retry')
      return { success: true, message: `Retry ${retryNum} triggered from ${fromStage}` }
    },
  }
}

function createFixIssueAction(
  task: EvaluatedTask,
  taskState: FixerTaskState,
  fixerState: FixerState,
): ActionRequest {
  const failedStage = task.failedStage || 'unknown'
  const errorSummary = (task.failedError || 'Unknown error').slice(0, 80)

  return {
    plugin: 'cody-pipeline-fixer',
    type: 'create-fix-issue',
    target: task.taskId,
    urgency: 'critical',
    title: `Create fix issue for ${task.taskId}`,
    detail: `Pipeline fails at ${failedStage} after ${taskState.retries} retries`,
    dedupKey: `pipeline-fixer:${task.taskId}`,
    dedupWindowMinutes: DEDUP_WINDOW_MINUTES,
    async execute(ctx: InspectorContext) {
      // Get original issue body for context
      const issue = ctx.github.getIssue(task.issueNumber)
      const issueBody = issue.body || ''

      const title = `[pipeline-fix] Cody fails at ${failedStage}: ${errorSummary}`
      const body = buildFixIssueBody(task, taskState, issueBody)
      const labels = ['cody:pipeline-fix']

      const fixIssueNumber = ctx.github.createIssue(title, body, labels)

      if (!fixIssueNumber) {
        ctx.log.error({ taskId: task.taskId }, 'Failed to create fix issue')
        return { success: false, message: 'Failed to create fix issue' }
      }

      // Trigger Cody on the fix issue
      ctx.github.postComment(fixIssueNumber, '@cody')

      // Notify on the original issue
      ctx.github.postComment(
        task.issueNumber,
        `🔧 **[pipeline-fixer]** Created fix issue #${fixIssueNumber} — Cody will analyze and fix the pipeline.`,
      )

      // Update state
      const newTaskState: FixerTaskState = {
        ...taskState,
        retries: taskState.retries,
        fixIssueNumber,
        fixIssueCreatedAt: new Date().toISOString(),
      }
      fixerState[task.taskId] = newTaskState
      saveFixerState(ctx, fixerState)

      ctx.log.info({ taskId: task.taskId, fixIssueNumber }, 'Created fix issue and triggered Cody')
      return { success: true, message: `Created fix issue #${fixIssueNumber}` }
    },
  }
}

function createGiveUpAction(task: EvaluatedTask, fixerState: FixerState): ActionRequest {
  return {
    plugin: 'cody-pipeline-fixer',
    type: 'give-up',
    target: task.taskId,
    urgency: 'warning',
    title: `Giving up on ${task.taskId}`,
    detail: `Exhausted ${MAX_RETRIES} retry attempts`,
    dedupKey: `pipeline-fixer:${task.taskId}`,
    dedupWindowMinutes: 60 * 24, // Don't re-trigger for 24h
    async execute(ctx: InspectorContext) {
      const fixRef = fixerState[task.taskId]?.fixIssueNumber
        ? ` + fix issue #${fixerState[task.taskId].fixIssueNumber}`
        : ''

      ctx.github.postComment(
        task.issueNumber,
        `⛔ **[pipeline-fixer]** Exhausted ${MAX_RETRIES} retry attempts${fixRef}. Manual intervention required.`,
      )

      // Clean up state
      delete fixerState[task.taskId]
      saveFixerState(ctx, fixerState)

      ctx.log.warn({ taskId: task.taskId }, 'Gave up after max retries')
      return { success: true, message: 'Gave up — manual intervention required' }
    },
  }
}

function createNonRetryableAction(task: EvaluatedTask): ActionRequest {
  return {
    plugin: 'cody-pipeline-fixer',
    type: 'non-retryable',
    target: task.taskId,
    urgency: 'warning',
    title: `Non-retryable failure: ${task.taskId}`,
    detail: task.failedError || 'Infrastructure failure',
    dedupKey: `pipeline-fixer:non-retryable:${task.taskId}`,
    dedupWindowMinutes: 60 * 24,
    async execute(ctx: InspectorContext) {
      ctx.github.postComment(
        task.issueNumber,
        `🚫 **[pipeline-fixer]** Non-retryable infrastructure failure detected. Fix the environment and rerun manually.\n\n**Error:** ${task.failedError || 'Unknown'}`,
      )
      ctx.log.warn({ taskId: task.taskId, error: task.failedError }, 'Non-retryable failure')
      return { success: true, message: 'Non-retryable notice posted' }
    },
  }
}

// ============================================================================
// Plugin
// ============================================================================

export const pipelineFixerPlugin: InspectorPlugin = {
  name: 'cody-pipeline-fixer',
  description: 'Retry failed tasks, escalate persistent failures by creating fix-issues for Cody',
  domain: 'cody',

  async run(ctx) {
    ctx.log.debug('Running pipeline-fixer plugin')

    const evaluated = ctx.state.get<EvaluatedTask[]>('cody:evaluatedTasks') || []
    const failed = evaluated.filter((t) => t.health === 'failed')

    if (failed.length === 0) {
      ctx.log.debug('No failed tasks')
      return []
    }

    // Skip tasks actively managed by queue-manager
    const queueState = getQueueState(ctx)
    const activeQueueTaskId = queueState.activeTaskId

    const fixerState = getFixerState(ctx)
    const actions: ActionRequest[] = []

    for (const task of failed) {
      // Skip queue-managed active tasks (queue-manager handles fail→advance)
      if (activeQueueTaskId && task.taskId === activeQueueTaskId) {
        ctx.log.debug({ taskId: task.taskId }, 'Skipping queue-managed active task')
        continue
      }

      // Skip tasks without a valid issue number
      if (!task.issueNumber || task.issueNumber <= 0) {
        continue
      }

      const taskState = getTaskState(fixerState, task.taskId)
      const currentSig = errorSignature(task.failedStage || 'unknown', task.failedError || '')

      // Non-retryable infrastructure failures
      if (isNonRetryable(task.failedError || '')) {
        actions.push(createNonRetryableAction(task))
        continue
      }

      // Give up after max retries
      if (taskState.retries >= MAX_RETRIES) {
        actions.push(createGiveUpAction(task, fixerState))
        continue
      }

      // Phase 1: Simple retries (0-1)
      if (taskState.retries < FIX_ISSUE_THRESHOLD) {
        actions.push(createRetryAction(task, taskState, fixerState))
        continue
      }

      // Phase 2: Create fix issue at threshold (same error repeated)
      if (taskState.retries === FIX_ISSUE_THRESHOLD && !taskState.fixIssueNumber) {
        if (currentSig === taskState.errorSignature) {
          // Same error — escalate to fix issue
          actions.push(createFixIssueAction(task, taskState, fixerState))
        } else {
          // Different error — retry with updated signature
          actions.push(createRetryAction(task, taskState, fixerState))
        }
        continue
      }

      // Phase 3: Post-fix retries (3-4)
      if (taskState.fixIssueNumber) {
        actions.push(createRetryAction(task, taskState, fixerState))
        continue
      }

      // Fallback: retry
      actions.push(createRetryAction(task, taskState, fixerState))
    }

    ctx.log.info(
      { failedCount: failed.length, actionCount: actions.length },
      'Pipeline-fixer actions',
    )
    return actions
  },
}
