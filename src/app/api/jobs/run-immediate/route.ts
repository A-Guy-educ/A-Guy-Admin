import { apiError, apiSuccess } from '@/server/api/responses'
import { LOCK_TIMEOUT_MS } from '@/server/payload/jobs/constants'
import configPromise from '@payload-config'
import { ObjectId } from 'mongodb'
<<<<<<< Updated upstream
import { NextRequest, NextResponse } from 'next/server'
import type { SanitizedConfig } from 'payload'
import { getPayload } from 'payload'

async function getJobsCollection(configToUse: SanitizedConfig | Promise<SanitizedConfig>) {
  const resolvedConfig = await configToUse
  const db = (resolvedConfig as { db?: { connection?: { collection: (name: string) => unknown } } })
    .db
  const coll = db?.connection?.collection?.('payload-jobs')
=======
import { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { getPayload } from 'payload'

async function getJobsCollection(payloadInstance: Payload) {
  const db = payloadInstance.db as any
  const coll =
    db.collections?.jobs || db.collection?.('jobs') || db.connection?.collection?.('payload-jobs')
>>>>>>> Stashed changes
  if (!coll) throw new Error('Cannot access Jobs collection')
  return coll
}

async function atomicClaimAndRunJob(coll: any, jobId: string) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LOCK_TIMEOUT_MS)

  const job = await coll.findOneAndUpdate(
    {
      _id: new ObjectId(jobId),
      processing: { $ne: true },
      hasError: { $ne: true },
      $or: [{ lockExpiresAt: { $exists: false } }, { lockExpiresAt: { $lt: now } }],
    },
    {
      $set: {
        processing: true,
        startedAt: now,
        lockExpiresAt: expiresAt,
      },
    },
    { returnDocument: 'after' },
  )

  return job
}

async function updateJobStatus(
  coll: any,
  jobId: string,
  status: 'completed' | 'failed',
  output?: unknown,
): Promise<void> {
  const update: any = {
    processing: false,
    completedAt: new Date(),
    hasError: status === 'failed',
  }

  if (output) {
    update.jobOutput = output
  }

  await coll.updateOne({ _id: new ObjectId(jobId) }, { $set: update })
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config: configPromise })
    const { user } = await payload.auth({ headers: request.headers })

    // Admin-only access
    if (!user || (user as any).role !== 'admin') {
      return apiError('UNAUTHORIZED', 'Admin access required', 401)
    }

    const { jobId } = await request.json()

    if (!jobId) {
      return apiError('VALIDATION_ERROR', 'jobId is required', 400)
    }

<<<<<<< Updated upstream
    const coll = await getJobsCollection(configPromise)
=======
    // Access the jobs collection through payload.db
    const coll = await getJobsCollection(payload)

>>>>>>> Stashed changes
    const job = await atomicClaimAndRunJob(coll, jobId)

    if (!job) {
      return apiError('JOB_NOT_FOUND', 'Job not found, already running, or already completed', 404)
    }

    console.log(`[run-immediately] Executing job ${jobId} synchronously`)

    // Execute the task synchronously
    const req = {
      payload,
      user,
      headers: request.headers,
    }

    const { pdfToExercisesTask } = await import('@/server/payload/jobs/pdf-to-exercises-task')
    await pdfToExercisesTask.handler({ job, req })

    // Update job status to completed
    await updateJobStatus(coll, jobId, 'completed', job.output)

    console.log(`[run-immediately] Job ${jobId} completed successfully`)

    return apiSuccess({ jobId }, 'Job executed successfully')
  } catch (error) {
    console.error('[run-immediately] Error:', error)

    // Try to update job status to failed
    try {
      // Payload not needed here, just need config for getJobsCollection
      await getPayload({ config: configPromise })
      const coll = await getJobsCollection(configPromise)
      const { jobId } = await request.json().catch(() => ({}))

      if (jobId) {
        await updateJobStatus(coll, jobId, 'failed', { error: String(error) })
      }
    } catch (updateError) {
      console.error('[run-immediately] Failed to update job status:', updateError)
    }

    return apiError(
      'INTERNAL_ERROR',
      `Failed to execute job: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
    )
  }
}
