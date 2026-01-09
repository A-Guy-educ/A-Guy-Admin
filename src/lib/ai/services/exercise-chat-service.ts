/**
 * AI Chat Service for Exercise Help
 * Provides conversational assistance using Gemini API
 */
import { logger } from '@/utilities/logger'
import { ChatRole } from '../chat-message-role'
import type { ComposedPrompt } from '../context-policy'
import { getGeminiClient } from '../gemini-ai-provider.server'
import { AI_MODELS } from '../models'
import promptContent from '../prompts/exercise-chat-agent-prompt.md'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ExerciseChatInput {
  message: string
  acknowledgment: string
  conversationHistory?: ChatMessage[]
  composedPrompt?: ComposedPrompt
}

export interface ExerciseChatResult {
  success: boolean
  message?: string
  error?: string
}

export function getSystemPrompt(): string {
  // Extract content, remove markdown headers
  return promptContent
    .replace(/^#.*$/gm, '')
    .replace(/^##.*$/gm, '')
    .trim()
}

export async function chatWithExerciseHelper(
  input: ExerciseChatInput,
): Promise<ExerciseChatResult> {
  try {
    const client = getGeminiClient()
    const modelConfig = AI_MODELS.EXERCISE_CHAT
    const model = client.getGenerativeModel({
      model: modelConfig.name,
      generationConfig: {
        temperature: modelConfig.temperature,
        maxOutputTokens: modelConfig.maxOutputTokens,
      },
    })

    // Use composed prompt if provided (Context Policy V1)
    if (input.composedPrompt) {
      const history: any[] = []
      let lastUserMessageContent: string | null = null

      // Convert composed prompt to Gemini format
      // CRITICAL: Track the last user message to avoid duplication
      for (const msg of input.composedPrompt.messages) {
        if (msg.role === 'system') {
          // System message becomes user + model acknowledgment
          history.push({
            role: ChatRole.User,
            parts: [{ text: msg.content }],
          })
          history.push({
            role: ChatRole.Assistant,
            parts: [{ text: input.acknowledgment }],
          })
        } else if (msg.role === 'user') {
          lastUserMessageContent = msg.content
          history.push({
            role: ChatRole.User,
            parts: [{ text: msg.content }],
          })
        } else if (msg.role === 'assistant') {
          history.push({
            role: ChatRole.Assistant,
            parts: [{ text: msg.content }],
          })
        }
      }

      // CRITICAL: The current user message is already in the composed prompt
      // (because it was persisted first, then reloaded). We need to extract it
      // and send it separately to Gemini, not include it in history.
      let currentMessage = input.message

      if (lastUserMessageContent === input.message && history.length > 0) {
        const lastEntry = history[history.length - 1]
        if (lastEntry.role === ChatRole.User) {
          // Remove the current user message from history (it will be sent via sendMessage)
          history.pop()
          currentMessage = lastUserMessageContent
        }
      }

      // DEBUG: Log history size
      logger.debug(
        {
          historyLength: history.length,
          composedPromptMessages: input.composedPrompt.messages.length,
          currentMessage: currentMessage.substring(0, 50),
        },
        '[DEBUG] Gemini history prepared',
      )

      // Start chat with history (excluding current message)
      const chat = model.startChat({ history })
      // Send current message to get response
      const result = await chat.sendMessage(currentMessage)
      const responseText = result.response.text()

      return {
        success: true,
        message: responseText,
      }
    }

    // Fallback: Legacy mode (for backward compatibility)
    const systemPrompt = getSystemPrompt()
    const history: any[] = [
      {
        role: ChatRole.User,
        parts: [{ text: systemPrompt }],
      },
      {
        role: ChatRole.Assistant,
        parts: [{ text: input.acknowledgment }],
      },
    ]

    // Add conversation history if provided
    if (input.conversationHistory && input.conversationHistory.length > 0) {
      const historyMessages = input.conversationHistory.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      }))
      history.push(...historyMessages)
    }

    // Start chat with full history
    const chat = model.startChat({
      history,
    })

    const result = await chat.sendMessage(input.message)
    const responseText = result.response.text()

    return {
      success: true,
      message: responseText,
    }
  } catch (error) {
    logger.error({ err: error }, 'Exercise chat error')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process chat message',
    }
  }
}
