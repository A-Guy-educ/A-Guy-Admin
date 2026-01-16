/**
 * API Service
 *
 * Encapsulates all API calls with error handling.
 * Provides simple interface for components to interact with backend endpoints.
 */
import { ChatRole } from '@/lib/ai/chat-message-role'
import { logger } from '@/utilities/logger'

export interface ChatApiResponse {
  success: boolean
  message?: string
  error?: string
  authRequired?: boolean
  conversationId?: string
  contextKey?: string
}

export interface ConversationMessage {
  role: string
  content: string
}

export interface ConversationApiResponse {
  success: boolean
  exists: boolean
  conversationId?: string
  messages: ConversationMessage[]
  error?: string
  authRequired?: boolean
  contextKey?: string
}

export interface ResetChatApiResponse {
  success: boolean
  conversationId?: string
  contextKey?: string
  error?: string
}

export const apiService = {
  /**
   * Send a message to the AI chat assistant
   *
   * @param message - The user's message
   * @param acknowledgment - The AI's acknowledgment message (from locale)
   * @param context - Context parameters (prefer IDs over slugs)
   * @returns Response with success status and either message or error
   */
  async chat(
    message: string,
    acknowledgment: string,
    context: {
      exerciseId?: string
      lessonId?: string
      chapterId?: string
      courseId?: string
    },
  ): Promise<ChatApiResponse> {
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, acknowledgment, ...context }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Specific handling for auth errors
        if (response.status === 401) {
          return { success: false, authRequired: true }
        }
        return { success: false, error: data.error || 'Request failed' }
      }

      if (data.success && data.message) {
        return {
          success: true,
          message: data.message,
          conversationId: data.conversationId,
          contextKey: data.contextKey,
        }
      }

      return { success: false, error: 'Invalid response format' }
    } catch (_error) {
      // Network errors or other exceptions
      return { success: false, error: 'Network error' }
    }
  },

  /**
   * Fetch existing conversation history for a context using custom endpoint
   * Custom endpoint explicitly verifies user ownership for security
   *
   * @param contextKey - The context key (e.g., "exercises:abc123")
   * @returns Conversation history with messages
   */
  async getConversation(contextKey: string): Promise<ConversationApiResponse> {
    try {
      // Use custom endpoint that explicitly verifies user ownership
      // This is more reliable than Payload's REST API which may not always apply access control correctly
      const url = `/api/agent/get-conversation?contextKey=${encodeURIComponent(contextKey)}`
      
      logger.debug({ contextKey, url }, '[getConversation] Fetching conversation')

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for authentication
      })

      const data = await response.json()

      if (!response.ok) {
        // Log the full error for debugging
        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            data,
            contextKey,
          },
          '[getConversation] API error',
        )

        if (response.status === 401 || response.status === 403) {
          return { success: false, exists: false, messages: [], authRequired: true }
        }
        return {
          success: false,
          exists: false,
          messages: [],
          error: data.error || 'Request failed',
        }
      }

      // Custom endpoint returns { success, exists, conversationId, messages, ... }
      if (data.success && data.exists) {
        // Ensure messages array exists and is properly formatted
        const rawMessages = data.messages || []
        const messages = rawMessages
          .filter((msg) => msg && msg.role && msg.content) // Filter out invalid messages
          .map((msg) => ({
            role: msg.role === ChatRole.User || msg.role === 'user' ? ChatRole.User : ChatRole.Assistant,
            content: msg.content,
          }))

        logger.debug(
          {
            conversationId: data.conversationId,
            contextKey,
            rawMessageCount: rawMessages.length,
            validMessageCount: messages.length,
            hasMessages: rawMessages.length > 0,
          },
          '[getConversation] Loaded conversation',
        )

        return {
          success: true,
          exists: true,
          conversationId: data.conversationId,
          contextKey,
          messages,
        }
      }

      // No conversation exists yet
      logger.debug({ contextKey }, '[getConversation] No conversation found for contextKey')

      return {
        success: true,
        exists: false,
        messages: [],
        contextKey,
      }
    } catch (_error) {
      return { success: false, exists: false, messages: [], error: 'Network error' }
    }
  },

  /**
   * Reset chat for a context (archive current, create new)
   *
   * @param contextKey - The context key to reset
   * @returns Response with new conversation ID
   */
  async resetChat(contextKey: string): Promise<ResetChatApiResponse> {
    try {
      const response = await fetch('/api/agent/reset-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contextKey }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: 'Authentication required' }
        }
        return { success: false, error: data.error || 'Request failed' }
      }

      if (data.success) {
        return {
          success: true,
          conversationId: data.conversationId,
          contextKey: data.contextKey,
        }
      }

      return { success: false, error: 'Reset failed' }
    } catch (_error) {
      return { success: false, error: 'Network error' }
    }
  },
}
