/**
 * @fileType scenario
 * @domain cody | system-test
 * @ai-summary High-complexity full mode scenario - exercises ALL pipeline stages
 *
 * Steps:
 *   1. Create GitHub issue
 *   2. Dispatch cody workflow (mode=full, complexity=65)
 *   3. Poll for workflow completion
 *   4. Assert results (labels, PR, comments)
 */

import { execFileSync } from 'child_process'

import { assertLabelsPresent, assertPRCreated, assertCommentExists, pollWorkflowRun } from '../lib'
import { CODY_WORKFLOW, SYSTEM_TEST_LABEL, ISSUE_TITLE_PREFIX } from '../lib/config'
import type { ScenarioContext, Scenario } from './types'
import type { ScenarioResult } from '../lib/report'

const ISSUE_BODY = `Create a new documentation file \`docs/system-test/pipeline-health.md\` that documents the Cody pipeline health monitoring architecture. Include:

1. An overview section describing the inspector plugin framework
2. A section on each health-check plugin and what it monitors
3. A section on the pipeline-fixer retry strategy
4. A section on deferred test and docs stages
5. A troubleshooting guide for common failure modes
6. Architecture diagrams in mermaid syntax

This documentation should be comprehensive (2000+ words) and reference actual file paths in the codebase.

**This is a SYSTEM TEST. The PR should NOT be merged.**`

export const scenario02: Scenario = {
  name: '02-full-high-complexity',
  description:
    'High-complexity full mode - exercises ALL pipeline stages (taskify, gap, architect, plan-gap, build, commit, review, verify, pr)',
  timeoutMs: 90 * 60 * 1000, // 90 minutes

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const startTime = Date.now()
    const assertions: ScenarioResult['assertions'] = []

    let issueNumber: number | undefined = undefined
    let taskId: string | undefined
    let workflowDispatchTime: string | undefined

    try {
      // Step 1: Create issue
      ctx.log.info('Creating issue...')
      const title = `${ISSUE_TITLE_PREFIX} Document pipeline health monitoring architecture`
      issueNumber = ctx.gh.createIssue(title, ISSUE_BODY, [SYSTEM_TEST_LABEL]) ?? undefined

      if (!issueNumber) {
        throw new Error('Failed to create issue')
      }
      assertions.push({ name: 'Issue created', passed: true, detail: `#${issueNumber}` })
      ctx.log.info(`Created issue #${issueNumber}`)

      // Step 2: Dispatch pipeline with complexity override
      const now = new Date()
      const yy = String(now.getFullYear()).slice(-2)
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      taskId = `${yy}${mm}${dd}-systest-${ctx.runId}`
      workflowDispatchTime = now.toISOString()

      ctx.log.info(`Dispatching pipeline: task=${taskId}, complexity=65`)

      execFileSync(
        'gh',
        [
          'workflow',
          'run',
          CODY_WORKFLOW,
          '-f',
          `task_id=${taskId}`,
          '-f',
          'mode=full',
          '-f',
          `issue_number=${issueNumber}`,
          '-f',
          'complexity=65',
          '-f',
          'clarify=false',
          '-f',
          'dry_run=false',
          '--repo',
          ctx.repo,
        ],
        { env: { ...process.env }, stdio: 'pipe' },
      )

      assertions.push({ name: 'Pipeline dispatched', passed: true, detail: taskId })
      ctx.log.info(`Dispatched pipeline for task ${taskId}`)

      // Step 3: Poll for workflow completion
      ctx.log.info('Polling for workflow completion (up to 90 min)...')
      const run = await pollWorkflowRun(ctx.gh, {
        workflow: CODY_WORKFLOW,
        afterTimestamp: workflowDispatchTime,
        matchBranch: new RegExp(taskId),
        maxWaitMs: 90 * 60 * 1000,
        intervalMs: 30 * 1000,
      })

      assertions.push({
        name: 'Workflow completed',
        passed: true,
        detail: `Run ${run.id}, conclusion: ${run.conclusion}`,
      })

      // Step 4: Assert results
      if (run.conclusion === 'success') {
        assertions.push({ name: 'Workflow succeeded', passed: true })
      } else {
        assertions.push({
          name: 'Workflow succeeded',
          passed: false,
          detail: `Expected success, got: ${run.conclusion}`,
        })
      }

      // Check labels
      try {
        assertLabelsPresent(ctx.gh, issueNumber, ['cody:done'])
        assertions.push({ name: 'cody:done label', passed: true })
      } catch (error) {
        assertions.push({ name: 'cody:done label', passed: false, detail: String(error) })
      }

      // Check task comment
      try {
        assertCommentExists(ctx.gh, issueNumber, /Task created:/)
        assertions.push({ name: 'Task marker comment', passed: true })
      } catch (error) {
        assertions.push({ name: 'Task marker comment', passed: false, detail: String(error) })
      }

      // Check PR created
      try {
        const pr = assertPRCreated(ctx.repo, new RegExp(taskId))
        assertions.push({
          name: 'PR created',
          passed: true,
          detail: `PR #${pr.number}: ${pr.branch}`,
        })
      } catch (error) {
        assertions.push({ name: 'PR created', passed: false, detail: String(error) })
      }

      return {
        name: this.name,
        passed: assertions.every((a) => a.passed),
        duration: Date.now() - startTime,
        assertions,
      }
    } catch (error) {
      return {
        name: this.name,
        passed: false,
        duration: Date.now() - startTime,
        assertions,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
}

export default scenario02
