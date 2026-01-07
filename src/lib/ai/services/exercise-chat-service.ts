/**
 * AI Chat Service for Exercise Help
 * Provides conversational assistance using Gemini API
 */
import { getGeminiClient } from '../gemini-ai-provider.server'
import { AI_MODELS } from '../models'
import { logger } from '@/utilities/logger/logger'
import { readFile } from 'fs/promises'
import { join } from 'path'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ExerciseChatInput {
  message: string
  conversationHistory?: ChatMessage[]
  acknowledgment: string
}

export interface ExerciseChatResult {
  success: boolean
  message?: string
  error?: string
}

let cachedSystemPrompt: string | null = null

async function getSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) {
    return cachedSystemPrompt
  }

  try {
    const promptPath = join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'exercise-chat.md')
    const content = await readFile(promptPath, 'utf-8')
    // Extract content, remove markdown headers
    cachedSystemPrompt = content
      .replace(/^#.*$/gm, '')
      .replace(/^##.*$/gm, '')
      .trim()
    return cachedSystemPrompt
  } catch (error) {
    logger.error({ err: error }, 'Failed to load system prompt from file')
    throw new Error('Failed to load system prompt')
  }
}

export async function chatWithExerciseHelper(
  input: ExerciseChatInput,
): Promise<ExerciseChatResult> {
  try {
    const systemPrompt = await getSystemPrompt()
    const client = getGeminiClient()
    const modelConfig = AI_MODELS.EXERCISE_CHAT
    const model = client.getGenerativeModel({
      model: modelConfig.name,
      generationConfig: {
        temperature: modelConfig.temperature,
        maxOutputTokens: modelConfig.maxOutputTokens,
      },
    })

    // Build conversation history
    const history = (input.conversationHistory || []).map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }))

    // Start chat with history
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: systemPrompt }],
        },
        {
          role: 'model',
          parts: [{ text: input.acknowledgment }],
        },
        ...history,
      ],
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
