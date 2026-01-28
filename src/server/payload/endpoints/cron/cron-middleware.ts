/**
 * Generic Cron Middleware
 * Provides authentication, error handling, and response formatting for cron endpoints
 */
import type { PayloadRequest } from 'payload'
import type { Logger } from 'pino'

import { logger } from '@/infra/utils/logger'

/**
 * Get CRON_SECRET from environment
 * Note: For production, this should be stored in Config_entries table
 * and fetched at runtime. This is a fallback for backward compatibility.
 */
function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET
}

export interface CronHandlerContext {
  reqLogger: Logger
  requestId: string
  payload: PayloadRequest['payload']
}

export interface CronSuccessResult {
  success: true
  data: Record<string, unknown>
}

export interface CronErrorResult {
  success: false
  error: string
  statusCode?: number
}

export type CronResult = CronSuccessResult | CronErrorResult

export type CronHandler = (context: CronHandlerContext) => Promise<CronResult>

/**
 * Authenticate cron request using Bearer token
 */
function authenticateCronRequest(
  authHeader: string | null,
  cronSecret: string | undefined,
  reqLogger: Logger,
): boolean {
  if (!cronSecret) {
    reqLogger.error('CRON_SECRET environment variable not configured')
    return false
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    reqLogger.warn('Unauthorized cron request')
    return false
  }

  return true
}

/**
 * Create standard cron response
 */
function createCronResponse(result: CronResult): Response {
  if (result.success) {
    return Response.json({
      success: true,
      ...result.data,
      timestamp: new Date().toISOString(),
    })
  }

  return Response.json({ error: result.error }, { status: result.statusCode || 500 })
}

/**
 * Wrap a cron handler with authentication and error handling
 *
 * Usage:
 * ```ts
 * export const myEndpoint: Endpoint = {
 *   path: '/cron/my-job',
 *   method: 'post',
 *   handler: withCronMiddleware(async ({ reqLogger, payload }) => {
 *     // Your cron logic here
 *     return { success: true, data: { processed: 10 } }
 *   }),
 * }
 * ```
 */
export function withCronMiddleware(handler: CronHandler) {
  return async (req: PayloadRequest): Promise<Response> => {
    const requestId = crypto.randomUUID()
    const reqLogger = logger.child({ requestId })

    // Authenticate
    const authHeader = req.headers?.get('authorization')
    const cronSecret = getCronSecret()

    if (!authenticateCronRequest(authHeader, cronSecret, reqLogger)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const result = await handler({
        reqLogger,
        requestId,
        payload: req.payload,
      })

      return createCronResponse(result)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      reqLogger.error({ error: errorMsg }, 'Cron job failed')
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
