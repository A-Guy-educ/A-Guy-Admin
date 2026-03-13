/**
 * @fileType utility
 * @domain ci | cody | agent-execution
 * @pattern runner-backend
 * @ai-summary Pluggable runner backend for Cody: supports both local (ocode) and CI (opencode github run) modes
 */

import { spawn, type ChildProcess } from 'child_process'

import { getEnv } from './env'

// ============================================================================
// Types
// ============================================================================

/** Options passed to runner.spawn() for server mode */
export interface RunnerSpawnOptions {
  /** URL of running OpenCode server to attach to */
  serverUrl?: string
  /** Session ID to fork from (requires serverUrl) */
  sessionId?: string
}

export interface RunnerBackend {
  name: string
  spawn(
    stage: string,
    prompt: string,
    env: NodeJS.ProcessEnv,
    cwd: string,
    options?: RunnerSpawnOptions,
  ): ChildProcess
}

// ============================================================================
// GitHub Runner (CI mode)
// ============================================================================

export class GitHubRunner implements RunnerBackend {
  name = 'opencode-github'

  spawn(
    stage: string,
    prompt: string,
    env: NodeJS.ProcessEnv,
    cwd: string,
    options?: RunnerSpawnOptions,
  ): ChildProcess {
    // Build args dynamically to support --attach (server mode) and --session --fork (continuation)
    const args = ['exec', 'opencode', 'run', '--agent', stage, '--format', 'json']
    if (options?.serverUrl) args.push('--attach', options.serverUrl)
    if (options?.sessionId) args.push('--session', options.sessionId, '--fork')
    args.push(prompt)
    return spawn('pnpm', args, {
      cwd,
      // Pipe stdout for JSON parsing (sessionID extraction), pipe stderr for capture
      stdio: ['ignore', 'pipe', 'pipe'], // stdin=ignore prevents opencode blocking on stdin read
      env,
    })
  }
}

// ============================================================================
// Local Runner (uses pnpm ocode run)
// ============================================================================

export class LocalRunner implements RunnerBackend {
  name = 'opencode-local'

  spawn(
    stage: string,
    prompt: string,
    env: NodeJS.ProcessEnv,
    cwd: string,
    options?: RunnerSpawnOptions,
  ): ChildProcess {
    // Build args dynamically to support --attach (server mode) and --session --fork (continuation)
    const args = ['ocode', 'run', '--agent', stage, '--format', 'json']
    if (options?.serverUrl) args.push('--attach', options.serverUrl)
    if (options?.sessionId) args.push('--session', options.sessionId, '--fork')
    args.push(prompt)
    return spawn('pnpm', args, {
      cwd,
      // Pipe stdout for JSON parsing (sessionID extraction), pipe stderr for capture
      stdio: ['ignore', 'pipe', 'pipe'], // stdin=ignore prevents opencode blocking on stdin read
      env: {
        ...env,
        AGENT: stage,
        MODEL: env.MODEL,
      },
    })
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a runner backend based on the environment.
 *
 * @param local - If true, uses local runner. If false, uses GitHub runner.
 *                If undefined, auto-detects: local when GITHUB_ACTIONS is not set.
 */
export function createRunner(local?: boolean): RunnerBackend {
  const env = getEnv()
  const useLocal = local ?? !env.GITHUB_ACTIONS

  if (useLocal) {
    return new LocalRunner()
  }
  return new GitHubRunner()
}
