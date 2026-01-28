/**
 * Chat Memory Retrieval
 * Handles vector search memory retrieval for chat context
 */
import type { Payload } from 'payload'
import type { Logger } from 'pino'
import type { Db } from 'mongodb'

import { buildRetrievalQuery, type Message } from '@/infra/llm/context-policy'
import { isVectorIndexAvailable } from '@/infra/llm/vector-index-check'
import { retrieveMemoryItems, type MemoryItem } from '@/infra/llm/vector-search'

export interface MemoryRetrievalResult {
  items: MemoryItem[]
  latencyMs: number
  localCount: number
  contextCount: number
  globalCount: number
  hierarchyKeys: string[]
}

const EMPTY_RESULT: MemoryRetrievalResult = {
  items: [],
  latencyMs: 0,
  localCount: 0,
  contextCount: 0,
  globalCount: 0,
  hierarchyKeys: [],
}

/**
 * Retrieve memory items for the conversation context
 * Handles graceful degradation if vector index is not available
 */
export async function retrieveMemories(
  payload: Payload,
  userId: string,
  conversationId: string,
  contextKey: string,
  recentMessages: Message[],
  reqLogger: Logger,
): Promise<MemoryRetrievalResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (payload.db as any).connection.db as Db

    // Graceful check: skip retrieval if index not available
    const indexAvailable = await isVectorIndexAvailable(db)

    if (!indexAvailable) {
      reqLogger.warn('Vector search index not available, skipping memory retrieval')
      return EMPTY_RESULT
    }

    const queryText = buildRetrievalQuery(recentMessages)

    // Skip retrieval if query is empty or too short
    if (!queryText || queryText.trim().length < 3) {
      reqLogger.debug(
        { queryText, queryLength: queryText?.trim().length },
        'Skipping memory retrieval: query text too short or empty',
      )
      return EMPTY_RESULT
    }

    reqLogger.debug({ queryText }, 'Retrieving memory items')

    const retrieval = await retrieveMemoryItems(
      db,
      userId,
      queryText,
      conversationId,
      contextKey,
      payload,
    )

    const result: MemoryRetrievalResult = {
      items: retrieval.items,
      latencyMs: retrieval.latencyMs,
      localCount: retrieval.localCount,
      contextCount: retrieval.contextCount,
      globalCount: retrieval.globalCount,
      hierarchyKeys: retrieval.hierarchyKeys,
    }

    reqLogger.info(
      {
        memoryCount: result.items.length,
        localCount: result.localCount,
        contextCount: result.contextCount,
        globalCount: result.globalCount,
        latencyMs: result.latencyMs,
        queryText,
        hierarchyKeys: result.hierarchyKeys,
      },
      'Retrieved memory items with hierarchy',
    )

    return result
  } catch (error) {
    // Graceful degradation: continue without memories
    reqLogger.warn({ err: error }, 'Memory retrieval failed, continuing without memories')
    return EMPTY_RESULT
  }
}
