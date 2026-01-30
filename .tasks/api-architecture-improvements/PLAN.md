# Architecture Improvement Plan

**Complete 9-Phase Implementation across 3 Priorities**

Each phase is self-contained and delivers immediate value.

---

# Priority 1: Critical (High Impact)

## Phase 1.1: Unified API Response Layer

**Goal**: Standardize all API error/success responses across 16+ routes

### Create Response Utilities

**New file**: `src/server/api/responses.ts`

```typescript
import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import { formatZodErrors } from '@/infra/utils/validation'

// Standardized error codes (extensible)
export type ApiErrorCode =
  // Auth errors
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  // Validation errors
  | 'VALIDATION_ERROR'
  | 'MISSING_REQUIRED_FIELD'
  // Resource errors
  | 'NOT_FOUND'
  | 'LESSON_NOT_FOUND'
  | 'PROMPT_NOT_FOUND'
  | 'MEDIA_NOT_ATTACHED'
  // Job errors
  | 'JOB_NOT_FOUND'
  | 'JOB_ALREADY_RUNNING'
  | 'JOB_ALREADY_COMPLETED'
  // System errors
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    details?: Record<string, string[]>
  }
}

export interface ApiSuccessResponse<T = unknown> {
  success: true
  data?: T
  message?: string
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: Record<string, string[]>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    { error: { code, message, ...(details && { details }) } },
    { status }
  )
}

export function apiSuccess<T>(
  data?: T,
  message?: string,
  status = 200
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    { success: true, ...(data !== undefined && { data }), ...(message && { message }) },
    { status }
  )
}

export function apiValidationError(error: ZodError): NextResponse<ApiErrorResponse> {
  return apiError('VALIDATION_ERROR', 'Validation failed', 400, formatZodErrors(error))
}

export const ApiErrors = {
  unauthorized: (message = 'Authentication required') =>
    apiError('UNAUTHORIZED', message, 401),
  forbidden: (message = 'Access denied') =>
    apiError('FORBIDDEN', message, 403),
  notFound: (resource: string) =>
    apiError('NOT_FOUND', `${resource} not found`, 404),
  internal: (message = 'Internal server error') =>
    apiError('INTERNAL_ERROR', message, 500),
} as const
```

### Files to Refactor

| File | Current Pattern | Change |
|------|-----------------|--------|
| [run-immediate/route.ts](../../src/app/api/jobs/run-immediate/route.ts) | `{ error: string }` | Use `apiError()`, `apiSuccess()` |
| [status/route.ts](../../src/app/api/exercises/convert/status/route.ts) | `{ error: string }` | Use `apiError()`, `apiSuccess()` |
| [runner/route.ts](../../src/app/api/exercises/convert/runner/route.ts) | `{ error/success }` | Use `apiError()`, `apiSuccess()` |
| [queue-conversion.ts](../../src/server/payload/endpoints/exercises/queue-conversion.ts) | `Response.json()` | Use `apiError()` |

### Deliverables

- [ ] Create `src/server/api/responses.ts`
- [ ] Create `src/server/api/index.ts` (barrel export)
- [ ] Refactor 5 job-related routes
- [ ] Add tests for response utilities

---

## Phase 1.2: JobService Abstraction

**Goal**: Centralize all job operations into a single service

### Create Job Types

**New file**: `src/server/payload/jobs/types.ts`

```typescript
import type { ObjectId } from 'mongodb'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface JobContext {
  lessonId: string
  sourceDocId: string
  tenantId: string
}

export interface JobDocument {
  _id: ObjectId
  id: string
  taskSlug: string
  processing: boolean
  hasError: boolean
  completedAt?: Date
  startedAt?: Date
  lockExpiresAt?: Date
  createdAt: Date
  input: {
    ctx: JobContext
    [key: string]: unknown
  }
  output?: unknown
}

export interface JobWithStatus extends JobDocument {
  status: JobStatus
}
```

### Create JobService

**New file**: `src/server/payload/services/job-service.ts`

```typescript
import type { SanitizedConfig } from 'payload'
import { ObjectId, type Collection, type Document } from 'mongodb'
import { LOCK_TIMEOUT_MS } from '@/server/config/constants'
import type { JobDocument, JobStatus, JobContext, JobWithStatus } from '../jobs/types'

export class JobService {
  private constructor(private readonly collection: Collection<Document>) {}

  static async create(config: SanitizedConfig | Promise<SanitizedConfig>): Promise<JobService> {
    const resolvedConfig = await config
    const db = (resolvedConfig as { db?: { connection?: { collection: (name: string) => Collection } } }).db
    const collection = db?.connection?.collection?.('payload-jobs')
    if (!collection) throw new Error('Cannot access payload-jobs collection')
    return new JobService(collection)
  }

  computeStatus(doc: JobDocument): JobStatus {
    if (doc.processing) return 'running'
    if (doc.hasError) return 'failed'
    if (doc.completedAt) return 'completed'
    return 'queued'
  }

  async claimJob(jobId: string): Promise<JobDocument | null> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + LOCK_TIMEOUT_MS)

    const result = await this.collection.findOneAndUpdate(
      {
        _id: new ObjectId(jobId),
        processing: { $ne: true },
        hasError: { $ne: true },
        $or: [{ lockExpiresAt: { $exists: false } }, { lockExpiresAt: { $lt: now } }],
      },
      { $set: { processing: true, startedAt: now, lockExpiresAt: expiresAt } },
      { returnDocument: 'after' }
    )
    return result as JobDocument | null
  }

  async updateStatus(jobId: string, status: 'completed' | 'failed', output?: unknown): Promise<void> {
    const update: Record<string, unknown> = {
      processing: false,
      completedAt: new Date(),
      hasError: status === 'failed',
    }
    if (output !== undefined) update.output = output
    await this.collection.updateOne({ _id: new ObjectId(jobId) }, { $set: update })
  }

  async extendLock(jobId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + LOCK_TIMEOUT_MS)
    await this.collection.updateOne({ _id: new ObjectId(jobId) }, { $set: { lockExpiresAt: expiresAt } })
  }

  async findByContext(taskSlug: string, ctx: Partial<JobContext>, limit = 10): Promise<JobWithStatus[]> {
    const query: Record<string, unknown> = { taskSlug }
    if (ctx.lessonId) query['input.ctx.lessonId'] = ctx.lessonId
    if (ctx.sourceDocId) query['input.ctx.sourceDocId'] = ctx.sourceDocId
    if (ctx.tenantId) query['input.ctx.tenantId'] = ctx.tenantId

    const docs = await this.collection.find(query).sort({ createdAt: -1 }).limit(limit).toArray()
    return docs.map((doc) => ({
      ...doc,
      id: doc._id.toString(),
      status: this.computeStatus(doc as unknown as JobDocument),
    })) as JobWithStatus[]
  }

  async getById(jobId: string): Promise<JobWithStatus | null> {
    const doc = await this.collection.findOne({ _id: new ObjectId(jobId) })
    if (!doc) return null
    return { ...doc, id: doc._id.toString(), status: this.computeStatus(doc as unknown as JobDocument) } as JobWithStatus
  }
}
```

### Deliverables

- [ ] Create `src/server/payload/jobs/types.ts`
- [ ] Create `src/server/payload/services/job-service.ts`
- [ ] Create `src/server/payload/services/index.ts` (barrel)
- [ ] Refactor [run-immediate/route.ts](../../src/app/api/jobs/run-immediate/route.ts)
- [ ] Refactor [status/route.ts](../../src/app/api/exercises/convert/status/route.ts)
- [ ] Refactor [runner/route.ts](../../src/app/api/exercises/convert/runner/route.ts)
- [ ] Add unit tests for JobService
- [ ] Remove duplicate `computeJobStatus` from [queries.ts](../../src/server/payload/utils/queries.ts)

---

## Phase 1.3: Request Validation Layer

**Goal**: Standardize input validation with Zod schemas

### Create Job Schemas

**New file**: `src/server/api/schemas/job-schemas.ts`

```typescript
import { z } from 'zod'

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId format')

export const runJobSchema = z.object({
  jobId: objectIdSchema,
})

export const jobStatusQuerySchema = z.object({
  lessonId: objectIdSchema,
  mediaId: objectIdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(1),
})

export const queueConversionSchema = z.object({
  lessonId: objectIdSchema,
  mediaId: objectIdSchema,
  extractorPromptId: objectIdSchema,
  verifierPromptId: objectIdSchema,
})

export type RunJobInput = z.infer<typeof runJobSchema>
export type JobStatusQuery = z.infer<typeof jobStatusQuerySchema>
export type QueueConversionInput = z.infer<typeof queueConversionSchema>
```

### Add Validation Helpers to responses.ts

```typescript
import { safeValidate } from '@/infra/utils/validation'
import type { ZodSchema } from 'zod'

export async function parseAndValidate<T>(
  request: NextRequest,
  schema: ZodSchema<T>
): Promise<{ data: T } | { error: NextResponse<ApiErrorResponse> }> {
  try {
    const body = await request.json()
    const result = safeValidate(schema, body)
    if (!result.success) return { error: apiValidationError(result.error) }
    return { data: result.data }
  } catch {
    return { error: apiError('VALIDATION_ERROR', 'Invalid JSON body', 400) }
  }
}

export function parseQueryParams<T>(
  request: NextRequest,
  schema: ZodSchema<T>
): { data: T } | { error: NextResponse<ApiErrorResponse> } {
  const { searchParams } = new URL(request.url)
  const params = Object.fromEntries(searchParams.entries())
  const result = safeValidate(schema, params)
  if (!result.success) return { error: apiValidationError(result.error) }
  return { data: result.data }
}
```

### Deliverables

- [ ] Create `src/server/api/schemas/job-schemas.ts`
- [ ] Create `src/server/api/schemas/index.ts` (barrel)
- [ ] Add `parseAndValidate()` and `parseQueryParams()` to responses.ts
- [ ] Refactor job routes to use schema validation
- [ ] Add tests for schemas and validation helpers

---

# Priority 2: Important (Medium Impact)

## Phase 2.1: API Route Wrapper/Middleware

**Goal**: Reduce boilerplate in route handlers

### Create Route Wrapper

**New file**: `src/server/api/with-api-handler.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import type { ZodSchema } from 'zod'
import type { User } from 'payload'
import { requireAdmin, requireAuthenticated, requireAdminOrTestSecret } from '@/server/payload/utils/auth'
import { parseAndValidate, parseQueryParams, apiError, ApiErrors } from './responses'

export type AuthLevel = 'admin' | 'adminOrTest' | 'authenticated' | 'public'

export interface ApiContext<TBody = unknown, TQuery = unknown> {
  request: NextRequest
  payload: Awaited<ReturnType<typeof getPayload>>
  user: User | null
  body: TBody
  query: TQuery
}

export interface HandlerOptions<TBody, TQuery> {
  auth?: AuthLevel
  bodySchema?: ZodSchema<TBody>
  querySchema?: ZodSchema<TQuery>
}

export function withApiHandler<TBody = unknown, TQuery = unknown>(
  options: HandlerOptions<TBody, TQuery>,
  handler: (ctx: ApiContext<TBody, TQuery>) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const payload = await getPayload({ config: configPromise })
      const { user } = await payload.auth({ headers: request.headers })
      const authHeader = request.headers.get('authorization')

      // Auth check
      if (options.auth === 'admin') {
        try {
          requireAdmin(user)
        } catch {
          return ApiErrors.unauthorized('Admin access required')
        }
      } else if (options.auth === 'adminOrTest') {
        try {
          requireAdminOrTestSecret(user, authHeader)
        } catch {
          return ApiErrors.unauthorized('Admin access required')
        }
      } else if (options.auth === 'authenticated') {
        try {
          requireAuthenticated(user)
        } catch {
          return ApiErrors.unauthorized()
        }
      }

      // Parse body
      let body: TBody = undefined as TBody
      if (options.bodySchema) {
        const parsed = await parseAndValidate(request, options.bodySchema)
        if ('error' in parsed) return parsed.error
        body = parsed.data
      }

      // Parse query params
      let query: TQuery = undefined as TQuery
      if (options.querySchema) {
        const parsed = parseQueryParams(request, options.querySchema)
        if ('error' in parsed) return parsed.error
        query = parsed.data
      }

      return await handler({ request, payload, user, body, query })
    } catch (error) {
      console.error('[API Handler] Error:', error)
      return apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Internal error', 500)
    }
  }
}
```

### Example Usage

```typescript
// Before: 50+ lines with boilerplate
export async function POST(request: NextRequest) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  try { requireAdmin(user) } catch { return NextResponse.json({ error: '...' }, { status: 401 }) }
  const { jobId } = await request.json()
  if (!jobId) return NextResponse.json({ error: '...' }, { status: 400 })
  // ... business logic
}

// After: Clean handler
export const POST = withApiHandler(
  { auth: 'admin', bodySchema: runJobSchema },
  async ({ payload, body }) => {
    const { jobId } = body
    // ... business logic only
    return apiSuccess({ jobId })
  }
)
```

### Deliverables

- [ ] Create `src/server/api/with-api-handler.ts`
- [ ] Create typed `ApiContext` interface
- [ ] Add error boundary with logging
- [ ] Refactor 3-5 routes as proof of concept
- [ ] Document usage pattern

---

## Phase 2.2: Separate Business Logic from Routes

**Goal**: Move business logic to service layer

### Create Exercise Conversion Service

**New file**: `src/server/payload/services/exercise-conversion-service.ts`

```typescript
import type { Payload } from 'payload'
import { JobService } from './job-service'
import { TASK_SLUG } from '@/server/config/constants'

export interface QueueConversionParams {
  lessonId: string
  mediaId: string
  extractorPromptId: string
  verifierPromptId: string
}

export interface ConversionResult {
  jobId: string
  status: string
}

export class ExerciseConversionService {
  constructor(
    private readonly payload: Payload,
    private readonly jobService: JobService
  ) {}

  async queueConversion(params: QueueConversionParams): Promise<ConversionResult> {
    // Validate lesson exists and get tenant
    const lesson = await this.payload.findByID({ collection: 'lessons', id: params.lessonId })
    if (!lesson) throw new Error('Lesson not found')

    // Validate media belongs to lesson
    // Validate prompts exist and match tenant
    // Queue job via Payload

    const job = await this.payload.jobs.queue({
      task: TASK_SLUG,
      input: { /* ... */ }
    })

    return { jobId: job.id, status: 'queued' }
  }

  async getConversionStatus(lessonId: string, mediaId: string) {
    return this.jobService.findByContext(TASK_SLUG, { lessonId, sourceDocId: mediaId })
  }

  async runJobImmediate(jobId: string): Promise<ConversionResult> {
    const job = await this.jobService.claimJob(jobId)
    if (!job) throw new Error('Job not available')

    // Execute task
    // Update status

    return { jobId, status: 'completed' }
  }
}
```

### Route Becomes Thin Controller

```typescript
// src/app/api/exercises/convert/queue/route.ts
export const POST = withApiHandler(
  { auth: 'adminOrTest', bodySchema: queueConversionSchema },
  async ({ payload, body }) => {
    const jobService = await JobService.create(configPromise)
    const service = new ExerciseConversionService(payload, jobService)

    const result = await service.queueConversion(body)
    return apiSuccess(result, 'Conversion job queued')
  }
)
```

### Deliverables

- [ ] Create `src/server/payload/services/exercise-conversion-service.ts`
- [ ] Move validation logic from routes to service
- [ ] Move business logic from [queue-conversion.ts](../../src/server/payload/endpoints/exercises/queue-conversion.ts)
- [ ] Refactor routes to be thin controllers
- [ ] Add unit tests for service

---

## Phase 2.3: Task Registry Pattern

**Goal**: Dynamic task lookup instead of hardcoded imports

### Create Task Registry

**New file**: `src/server/payload/jobs/task-registry.ts`

```typescript
import type { TaskConfig } from 'payload'

type TaskHandler = TaskConfig<string, unknown>['handler']

interface RegisteredTask {
  slug: string
  handler: TaskHandler
  description?: string
}

class TaskRegistry {
  private tasks = new Map<string, RegisteredTask>()

  register(task: RegisteredTask): void {
    this.tasks.set(task.slug, task)
  }

  get(slug: string): RegisteredTask | undefined {
    return this.tasks.get(slug)
  }

  has(slug: string): boolean {
    return this.tasks.has(slug)
  }

  list(): string[] {
    return Array.from(this.tasks.keys())
  }
}

export const taskRegistry = new TaskRegistry()

// Auto-register tasks
export function registerTask(slug: string, handler: TaskHandler, description?: string) {
  taskRegistry.register({ slug, handler, description })
}
```

### Update Task Definition

```typescript
// src/server/payload/jobs/pdf-to-exercises-task.ts
import { registerTask } from './task-registry'
import { TASK_SLUG } from '@/server/config/constants'

export const pdfToExercisesTask = defineTask({
  slug: TASK_SLUG,
  handler: async ({ job, req }) => { /* ... */ }
})

// Register for dynamic lookup
registerTask(TASK_SLUG, pdfToExercisesTask.handler, 'Convert PDF to exercises')
```

### Update run-immediate to Use Registry

```typescript
// Before
const { pdfToExercisesTask } = await import('@/server/payload/jobs/pdf-to-exercises-task')
await pdfToExercisesTask.handler({ job, req })

// After
import { taskRegistry } from '@/server/payload/jobs/task-registry'

const task = taskRegistry.get(job.taskSlug)
if (!task) return apiError('NOT_FOUND', `Task ${job.taskSlug} not registered`, 404)
await task.handler({ job, req })
```

### Deliverables

- [ ] Create `src/server/payload/jobs/task-registry.ts`
- [ ] Update [pdf-to-exercises-task.ts](../../src/server/payload/jobs/pdf-to-exercises-task.ts) to register
- [ ] Update [run-immediate/route.ts](../../src/app/api/jobs/run-immediate/route.ts) to use registry
- [ ] Add tests for registry

---

# Priority 3: Nice to Have (Lower Impact)

## Phase 3.1: Standardize Logging

**Goal**: Replace console.log with structured Pino logging

### Create API Logger

**New file**: `src/server/api/logger.ts`

```typescript
import { createLogger } from '@/infra/utils/logger'
import type { NextRequest } from 'next/server'

export function createApiLogger(request: NextRequest, routeName: string) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()

  return createLogger().child({
    route: routeName,
    requestId,
    method: request.method,
    url: request.url,
  })
}
```

### Update Routes

```typescript
// Before
console.log(`[run-immediately] Executing job ${jobId} synchronously`)
console.error('[run-immediately] Error:', error)

// After
const logger = createApiLogger(request, 'run-immediate')
logger.info({ jobId }, 'Executing job synchronously')
logger.error({ error, jobId }, 'Job execution failed')
```

### Deliverables

- [ ] Create `src/server/api/logger.ts`
- [ ] Update job routes to use structured logging
- [ ] Add request ID propagation
- [ ] Remove all console.log/error from routes

---

## Phase 3.2: Type the Job System

**Goal**: Remove `@typescript-eslint/no-explicit-any` from job code

### Extend Job Types

**Update**: `src/server/payload/jobs/types.ts`

```typescript
// Task-specific input types
export interface PdfToExercisesInput {
  ctx: JobContext
  maxSegmentPages: number
  promptRefs: {
    extractorPromptId: string
    verifierPromptId: string
  }
  promptSnapshot: {
    extractor: string
    verifier: string
  }
  promptSnapshotHash: {
    extractor: string
    verifier: string
  }
}

// Task-specific output types
export interface PdfToExercisesOutput {
  exerciseIds: string[]
  segmentCount: number
  errors?: string[]
}

// Generic typed job
export interface TypedJob<TInput, TOutput> extends JobDocument {
  input: TInput
  output?: TOutput
}

export type PdfToExercisesJob = TypedJob<PdfToExercisesInput, PdfToExercisesOutput>
```

### Update Task Handler

```typescript
// Before
export const pdfToExercisesTask = defineTask({
  handler: async ({ job, req }) => {
    const ctx = job.input.ctx as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output: any = { exerciseIds: [] }
  }
})

// After
export const pdfToExercisesTask = defineTask({
  handler: async ({ job, req }) => {
    const typedJob = job as unknown as PdfToExercisesJob
    const ctx = typedJob.input.ctx // Fully typed!
    const output: PdfToExercisesOutput = { exerciseIds: [], segmentCount: 0 }
  }
})
```

### Deliverables

- [ ] Add task-specific input/output types to types.ts
- [ ] Update [pdf-to-exercises-task.ts](../../src/server/payload/jobs/pdf-to-exercises-task.ts)
- [ ] Remove eslint-disable comments
- [ ] Add type guards where needed

---

## Phase 3.3: Extract Constants

**Goal**: Centralize magic strings and values

### Create Job Constants

**New file**: `src/server/payload/jobs/constants.ts`

```typescript
export const JOBS_COLLECTION = 'payload-jobs' as const

export const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type JobStatusValue = (typeof JOB_STATUS)[keyof typeof JOB_STATUS]

export const JOB_FIELDS = {
  PROCESSING: 'processing',
  HAS_ERROR: 'hasError',
  COMPLETED_AT: 'completedAt',
  STARTED_AT: 'startedAt',
  LOCK_EXPIRES_AT: 'lockExpiresAt',
} as const
```

### Update JobService

```typescript
// Before
const collection = db?.connection?.collection?.('payload-jobs')

// After
import { JOBS_COLLECTION } from './constants'
const collection = db?.connection?.collection?.(JOBS_COLLECTION)
```

### Deliverables

- [ ] Create `src/server/payload/jobs/constants.ts`
- [ ] Update JobService to use constants
- [ ] Update routes to use constants
- [ ] Remove magic strings

---

# Final Directory Structure

```
src/server/
├── api/
│   ├── index.ts                      # Barrel export
│   ├── responses.ts                  # Phase 1.1: apiError, apiSuccess
│   ├── with-api-handler.ts           # Phase 2.1: Route wrapper
│   ├── logger.ts                     # Phase 3.1: API logging
│   └── schemas/
│       ├── index.ts
│       └── job-schemas.ts            # Phase 1.3: Zod schemas
├── payload/
│   ├── jobs/
│   │   ├── constants.ts              # Phase 3.3: Job constants
│   │   ├── types.ts                  # Phase 1.2 + 3.2: Job types
│   │   ├── task-registry.ts          # Phase 2.3: Task registry
│   │   └── pdf-to-exercises-task.ts
│   ├── services/
│   │   ├── index.ts
│   │   ├── job-service.ts            # Phase 1.2: JobService
│   │   └── exercise-conversion-service.ts  # Phase 2.2: Business logic
│   └── utils/
│       ├── auth.ts                   # Existing (no changes)
│       └── queries.ts                # Cleanup in Phase 1.2
```

---

# Verification Plan

After each phase:

1. **Typecheck**: `pnpm typecheck`
2. **Lint**: `pnpm lint`
3. **Unit tests**: `pnpm test:unit`
4. **Integration tests**: `pnpm test:int`
5. **Manual verification**:
   - Queue a conversion job via API
   - Check job status
   - Run job immediately
   - Verify error responses match new format

---

# Summary

| Priority | Phase | Focus | New Files | Effort |
|----------|-------|-------|-----------|--------|
| **1 Critical** | 1.1 | Unified Responses | 2 | ~2h |
| | 1.2 | JobService | 3 | ~3h |
| | 1.3 | Request Validation | 2 | ~2h |
| **2 Important** | 2.1 | Route Wrapper | 1 | ~2h |
| | 2.2 | Service Layer | 1 | ~3h |
| | 2.3 | Task Registry | 1 | ~1h |
| **3 Nice to Have** | 3.1 | Logging | 1 | ~1h |
| | 3.2 | Job Types | 0 | ~1h |
| | 3.3 | Constants | 1 | ~30m |

**Total Effort**: ~15-16 hours across all phases

**Recommended Order**: 1.1 → 1.2 → 1.3 → 2.1 → 2.2 → 2.3 → 3.1 → 3.2 → 3.3
