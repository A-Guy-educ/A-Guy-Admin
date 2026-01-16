import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { logger } from '@/utilities/logger/logger'

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const { searchParams } = new URL(request.url)
    const contextKey = searchParams.get('contextKey')

    if (!contextKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing contextKey parameter',
          requestId,
        },
        { status: 400 },
      )
    }

    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          exists: false,
          messages: [],
          authRequired: true,
          requestId,
        },
        { status: 401 },
      )
    }

    logger.debug({ requestId, contextKey, userId: user.id }, '[get-conversation] Fetching conversation')

    // Explicitly query with user filter and access control enforcement
    const result = await payload.find({
      collection: 'conversations',
      where: {
        and: [
          { contextKey: { equals: contextKey } },
          { archivedAt: { exists: false } },
          // Explicitly filter by user ID to ensure we only get the current user's conversation
          { user: { equals: user.id } },
        ],
      },
      limit: 1,
      sort: '-lastMessageAt', // Get most recent conversation
      depth: 0,
      user,
      overrideAccess: false, // CRITICAL: Enforce access control
    })

    if (result.docs.length === 0) {
      logger.debug({ requestId, contextKey, userId: user.id }, '[get-conversation] No conversation found')
      return NextResponse.json({
        success: true,
        exists: false,
        messages: [],
        contextKey,
        requestId,
      })
    }

    const conversation = result.docs[0]

    // Double-check that the conversation belongs to the current user (defense in depth)
    const conversationUserId =
      typeof conversation.user === 'object' ? conversation.user.id : conversation.user
    if (conversationUserId !== user.id) {
      logger.error(
        {
          requestId,
          contextKey,
          userId: user.id,
          conversationUserId,
          conversationId: conversation.id,
        },
        '[get-conversation] SECURITY: Conversation user mismatch - access control failed',
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Access denied',
          requestId,
        },
        { status: 403 },
      )
    }

    // Ensure messages array exists and is properly formatted
    const rawMessages = (conversation.messages as Array<{
      role: string
      content: string
      timestamp?: string
    }>) || []
    const messages = rawMessages
      .filter((msg) => msg && msg.role && msg.content)
      .map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }))

    logger.debug(
      {
        requestId,
        conversationId: conversation.id,
        contextKey,
        userId: user.id,
        messageCount: messages.length,
      },
      '[get-conversation] Conversation loaded',
    )

    return NextResponse.json({
      success: true,
      exists: true,
      conversationId: conversation.id,
      contextKey,
      messages,
      requestId,
    })
  } catch (error) {
    logger.error({ err: error, requestId }, '[get-conversation] Error fetching conversation')
    return NextResponse.json(
      {
        success: false,
        exists: false,
        messages: [],
        error: error instanceof Error ? error.message : 'Internal server error',
        requestId,
        ...(process.env.NODE_ENV === 'development' && error instanceof Error
          ? { stack: error.stack }
          : {}),
      },
      { status: 500 },
    )
  }
}
