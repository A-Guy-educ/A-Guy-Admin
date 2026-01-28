/**
 * Chat Background Tasks
 * Handles non-blocking background operations like summary maintenance and memory extraction
 */
import type { Payload } from 'payload'
import type { Logger } from 'pino'

import { ChatRole } from '@/infra/llm/chat-message-role'
import { runSummaryMaintenance } from '@/infra/llm/maintenance'
import { extractMemoryCandidates, persistMemoryItems } from '@/infra/llm/memory-extraction'
import { deriveContextLevel } from '@/server/services/conversation-service'

import type { ResolvedContext } from './context-resolution'

/**
 * Run summary maintenance in background (non-blocking)
 */
export function scheduleSummaryMaintenance(
  payload: Payload,
  conversationId: string,
  reqLogger: Logger,
): void {
  runSummaryMaintenance(payload, conversationId).catch((err) => {
    reqLogger.error({ err, conversationId }, 'Summary maintenance failed')
  })
}

/**
 * Extract and persist memories in background (non-blocking)
 */
export function scheduleMemoryExtraction(
  payload: Payload,
  conversationId: string,
  userId: string,
  context: ResolvedContext,
  user: { id: string },
  reqLogger: Logger,
): void {
  reqLogger.debug({ conversationId }, 'Starting memory extraction')

  // Refresh conversation to get potential summary updates
  payload
    .findByID({
      collection: 'conversations',
      id: conversationId,
      user,
      overrideAccess: false,
    })
    .then((updatedConv) => {
      const messages = updatedConv.messages || []
      reqLogger.debug({ messageCount: messages.length }, 'Loaded conversation for extraction')

      const messageList = messages.map((m) => ({
        role: m.role!,
        content: m.content!,
        timestamp: m.timestamp!,
      }))

      // Determine source role and timestamp
      const lastMessage = messages[messages.length - 1]
      const sourceRole = ChatRole.Assistant
      const sourceTimestamp = lastMessage?.timestamp ? new Date(lastMessage.timestamp) : new Date()

      // Derive context info for memory extraction
      const contextLevel = deriveContextLevel(context.relationTo)

      return extractMemoryCandidates(messageList, updatedConv.summary || undefined).then(
        (candidates) => {
          reqLogger.debug({ candidateCount: candidates.length }, 'Extracted memory candidates')
          return {
            candidates,
            sourceRole,
            sourceTimestamp,
            contextLevel,
          }
        },
      )
    })
    .then(({ candidates, sourceRole, sourceTimestamp, contextLevel }) => {
      if (candidates.length > 0) {
        reqLogger.debug({ candidateCount: candidates.length }, 'Persisting memory items')
        return persistMemoryItems(
          payload,
          userId,
          conversationId,
          candidates,
          sourceTimestamp,
          sourceRole,
          context.contextKey,
          contextLevel,
        ).then((persisted) => {
          reqLogger.info({ persisted, conversationId }, 'Memory extraction completed')
          return persisted
        })
      }

      reqLogger.debug('No memory candidates to persist')
      return 0
    })
    .catch((err) => {
      reqLogger.error({ err, conversationId }, 'Memory extraction failed')
    })
}
