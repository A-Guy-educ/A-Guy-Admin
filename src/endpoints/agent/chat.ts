/**
 * POST /api/agent/chat
 * Chat with AI assistant with context awareness
 *
 * Access: Authenticated users only
 *
 * Features:
 * - Running summary of conversation history
 * - Long-term memory with vector search
 * - Automatic maintenance and memory extraction
 */
import {
  buildRetrievalQuery,
  composePrompt,
  getRecentWindow,
  type Message,
} from '@/lib/ai/context-policy'
import { runSummaryMaintenance } from '@/lib/ai/maintenance'
import { extractMemoryCandidates, persistMemoryItems } from '@/lib/ai/memory-extraction'
import { createContextLog, logContextUsage, logPromptSnapshot } from '@/lib/ai/observability'
import { chatWithExerciseHelper, getSystemPrompt } from '@/lib/ai/services/exercise-chat-service'
import { isVectorIndexAvailable } from '@/lib/ai/vector-index-check'
import { retrieveMemoryItems, type MemoryItem } from '@/lib/ai/vector-search'
import { featureFlags } from '@/lib/feature-flags'
import type { Conversation } from '@/payload-types'
import { logger } from '@/utilities/logger'
import { PayloadRequest } from 'payload'
import { z } from 'zod'

const requestSchema = z.object({
  message: z.string().min(1).max(1000),
  acknowledgment: z.string().min(1),
  exerciseId: z.string().min(1),
})

export async function agentChat(req: PayloadRequest & { json?: () => Promise<unknown> }) {
  const requestId = crypto.randomUUID()
  const reqLogger = logger.child({ requestId })

  // 1) Auth - endpoints not authenticated by default
  if (!req.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    // 2) Parse and validate request body
    if (!req.json) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    const body = await req.json()
    const validated = requestSchema.parse(body)

    reqLogger.info(
      { userId: req.user.id, exerciseId: validated.exerciseId },
      'Processing chat request',
    )

    // 3) Find or create conversation
    const existingConv = await req.payload.find({
      collection: 'conversations',
      where: {
        and: [{ user: { equals: req.user.id } }, { exercise: { equals: validated.exerciseId } }],
      },
      limit: 1,
    })

    let conversationId: string
    let conversation: Conversation

    if (existingConv.docs.length > 0) {
      // Use existing conversation
      conversation = existingConv.docs[0]
      conversationId = conversation.id
      reqLogger.info({ conversationId }, 'Using existing conversation')
    } else {
      // Create new conversation
      const newConv = await req.payload.create({
        collection: 'conversations',
        data: {
          user: req.user.id,
          exercise: validated.exerciseId,
          messages: [],
          lastMessageAt: new Date().toISOString(),
          contextPolicyVersion: 'v1',
        },
        draft: false,
      })
      conversationId = newConv.id
      conversation = newConv
      reqLogger.info({ conversationId }, 'Created new conversation')
    }

    // 4) Persist user message FIRST
    const userMessage = {
      role: 'user' as const,
      content: validated.message,
      timestamp: new Date().toISOString(),
    }

    const conversationHistory = conversation.messages || []

    await req.payload.update({
      collection: 'conversations',
      id: conversationId,
      data: {
        messages: [...conversationHistory, userMessage],
        lastMessageAt: new Date().toISOString(),
      },
    })

    // 5) Reload conversation to get updated messages
    conversation = await req.payload.findByID({
      collection: 'conversations',
      id: conversationId,
    })

    const allMessages = conversation.messages || []

    // DEBUG: Log message count
    reqLogger.info(
      {
        conversationId,
        totalMessages: allMessages.length,
        messagePreview: allMessages.slice(-3).map((m: any) => ({
          role: m.role,
          content: m.content?.substring(0, 50),
        })),
      },
      '[DEBUG] Conversation messages loaded',
    )

    // 6) Get recent window from persisted messages
    const recentMessages = getRecentWindow(allMessages as Message[])

    reqLogger.info({ recentCount: recentMessages.length }, '[DEBUG] Recent window extracted')

    // 7) Retrieve memory items (if enabled)
    let memoryItems: MemoryItem[] = []
    let retrievalLatencyMs = 0
    let localCount = 0
    let globalCount = 0

    if (featureFlags.MEMORY_RETRIEVAL_ENABLED) {
      try {
        const db = (req.payload.db as any).connection.db

        // Graceful check: skip retrieval if index not available
        const indexAvailable = await isVectorIndexAvailable(db)

        if (indexAvailable) {
          const queryText = buildRetrievalQuery(recentMessages)

          const retrieval = await retrieveMemoryItems(db, req.user.id, queryText, conversationId)

          memoryItems = retrieval.items
          retrievalLatencyMs = retrieval.latencyMs
          localCount = retrieval.localCount
          globalCount = retrieval.globalCount

          reqLogger.debug(
            {
              memoryCount: memoryItems.length,
              localCount,
              globalCount,
              latencyMs: retrievalLatencyMs,
            },
            'Retrieved memory items',
          )
        } else {
          reqLogger.warn('Vector search index not available, skipping memory retrieval')
        }
      } catch (error) {
        // Graceful degradation: continue without memories
        reqLogger.warn({ err: error }, 'Memory retrieval failed, continuing without memories')
      }
    }

    // 8) Compose prompt using Context Policy V1
    const systemInstructions = getSystemPrompt()
    const composedPrompt = composePrompt(systemInstructions, {
      systemMessage: systemInstructions,
      summary: conversation?.summary || undefined,
      memoryItems: memoryItems,
      recentMessages: recentMessages,
    })

    // Log prompt snapshot in development
    logPromptSnapshot(conversationId, composedPrompt)

    // 9) Call AI service with composed prompt
    const result = await chatWithExerciseHelper({
      message: validated.message,
      acknowledgment: validated.acknowledgment,
      composedPrompt: composedPrompt,
    })

    if (!result.success) {
      reqLogger.error({ error: result.error }, 'Chat request failed')
      return Response.json(
        { error: result.error || 'Failed to process chat message' },
        { status: 500 },
      )
    }

    // 10) Persist assistant response
    const assistantMessage = {
      role: 'assistant' as const,
      content: result.message || '',
      timestamp: new Date().toISOString(),
    }

    const updatedMessages = [...allMessages, assistantMessage]

    await req.payload.update({
      collection: 'conversations',
      id: conversationId,
      data: {
        messages: updatedMessages,
        lastMessageAt: new Date().toISOString(),
      },
    })

    // 11) Log context usage for observability
    logContextUsage(
      createContextLog({
        conversationId,
        userId: req.user.id,
        policyVersion: composedPrompt.metadata.policyVersion,
        summaryPresent: !!conversation?.summary,
        summaryLength: composedPrompt.metadata.summaryLength,
        memoryLocalCount: localCount,
        memoryGlobalCount: globalCount,
        memoryRetrievalLatencyMs: retrievalLatencyMs,
        messageWindowSize: composedPrompt.metadata.messageCount,
        messageTotalCount: updatedMessages.length,
      }),
    )

    // 12) Background: Run summary maintenance (non-blocking)
    if (featureFlags.SUMMARY_MAINTENANCE_ENABLED) {
      runSummaryMaintenance(req.payload, conversationId).catch((err) => {
        reqLogger.error({ err, conversationId }, 'Summary maintenance failed')
      })
    }

    // 13) Background: Extract and persist memories (non-blocking)
    if (featureFlags.MEMORY_EXTRACTION_ENABLED && req.user) {
      const currentUserId = req.user.id
      // Refresh conversation to get potential summary updates
      req.payload
        .findByID({
          collection: 'conversations',
          id: conversationId,
        })
        .then((updatedConv) => {
          const messages = updatedConv.messages || []
          const messageList = messages.map((m) => ({
            role: m.role!,
            content: m.content!,
            timestamp: m.timestamp!,
          }))
          return extractMemoryCandidates(messageList, updatedConv.summary || undefined)
        })
        .then((candidates) => {
          if (candidates.length > 0) {
            return persistMemoryItems(
              req.payload,
              currentUserId,
              conversationId,
              candidates,
              new Date(),
              'model',
            )
          }
        })
        .catch((err) => {
          reqLogger.error({ err, conversationId }, 'Memory extraction failed')
        })
    }

    reqLogger.info('Chat request successful')
    return Response.json({
      success: true,
      message: result.message,
      conversationId,
    })
  } catch (error) {
    reqLogger.error({ err: error }, 'Chat endpoint error')

    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request', details: error.issues }, { status: 400 })
    }

    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
