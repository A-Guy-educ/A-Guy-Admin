/**
 * GET /api/agent/get-conversation
 * Get active conversation for a context using Payload's Local API
 *
 * @fileType endpoint
 * @domain chat
 * @pattern authenticated-endpoint, context-scoped
 * @ai-summary Get conversation endpoint using Payload Local API with proper access control
 *
 * Access: Authenticated users only
 *
 * Query parameters:
 * - contextKey: The context key (e.g., "exercises:abc123")
 *
 * Response:
 * - success: boolean
 * - exists: boolean
 * - conversationId?: string
 * - messages: ConversationMessage[]
 * - contextKey: string
 */
import { logger } from '@/utilities/logger'
import { PayloadRequest } from 'payload'
import { z } from 'zod'

const querySchema = z.object({
  contextKey: z.string().min(1),
})

export async function agentGetConversation(
  req: PayloadRequest & { nextUrl?: { searchParams: URLSearchParams } },
) {
  const requestId = crypto.randomUUID()
  const reqLogger = logger.child({ requestId })

  // 1) Auth check
  if (!req.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    // 2) Parse and validate query parameters
    if (!req.nextUrl?.searchParams) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    const contextKey = req.nextUrl.searchParams.get('contextKey')
    const validated = querySchema.parse({ contextKey })

    reqLogger.info(
      { userId: req.user.id, contextKey: validated.contextKey },
      'Processing get conversation request',
    )

    // 3) Get active conversation using Local API with proper access control
    // CRITICAL: Use user and overrideAccess: false to enforce access control
    // This ensures only the authenticated user's conversations are returned
    const result = await req.payload.find({
      collection: 'conversations',
      where: {
        and: [
          { user: { equals: req.user.id } }, // Explicitly filter by authenticated user
          { contextKey: { equals: validated.contextKey } },
          { archivedAt: { exists: false } },
        ],
      },
      limit: 1,
      user: req.user,
      overrideAccess: false, // CRITICAL: Enforce access control
    })

    const conversation = result.docs.length > 0 ? result.docs[0] : null

    if (!conversation) {
      reqLogger.debug(
        { userId: req.user.id, contextKey: validated.contextKey },
        'No active conversation found',
      )
      return Response.json({
        success: true,
        exists: false,
        messages: [],
        contextKey: validated.contextKey,
      })
    }

    // 4) Extract messages from conversation
    // Type assertion needed because Payload types may not match exactly
    const conversationMessages = (conversation.messages as Array<{
      role: string
      content: string
      timestamp?: string
    }>) || []

    const messages = conversationMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))

    reqLogger.info(
      {
        userId: req.user.id,
        contextKey: validated.contextKey,
        conversationId: conversation.id,
        messageCount: messages.length,
      },
      'Conversation retrieved successfully',
    )

    return Response.json({
      success: true,
      exists: true,
      conversationId: conversation.id,
      contextKey: validated.contextKey,
      messages,
    })
  } catch (error) {
    reqLogger.error({ err: error }, 'Get conversation endpoint error')

    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request', details: error.issues }, { status: 400 })
    }

    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
