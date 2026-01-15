import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { agentGetConversation } from '@/endpoints/agent/get-conversation'
import { logger } from '@/utilities/logger/logger'

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    logger.info({ requestId, url: request.url }, 'Get conversation request received')

    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    const payloadRequest = {
      payload,
      user,
      url: request.url,
      headers: request.headers,
      nextUrl: request.nextUrl,
    } as Parameters<typeof agentGetConversation>[0]

    logger.info(
      {
        requestId,
        contextKey: request.nextUrl.searchParams.get('contextKey'),
        userId: user?.id,
      },
      'Processing get conversation request',
    )
    return await agentGetConversation(payloadRequest)
  } catch (error) {
    logger.error({ err: error, requestId }, 'Get conversation route error')
    return NextResponse.json(
      {
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
