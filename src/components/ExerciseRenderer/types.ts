/**
 * Type definitions for Exercise Renderer
 */

export type PreviewMode = 'student' | 'debug'

export type UserAnswer =
  | { type: 'mcq'; selectedIds: string[] }
  | { type: 'true_false'; value: boolean | null }
  | { type: 'free_response'; value: string }

export interface CheckResult {
  isCorrect: boolean
  message?: string
}

/**
 * Content structure - supports both new and legacy formats
 * New: { content: { blocks: [] } }
 * Legacy: { stem: [], contentSchemaVersion: 1 | 2 }
 */
export type ExerciseContentData =
  | import('@/contracts').ExerciseContent // Legacy format
  | { content: { blocks: any[] } } // New format

export interface ExerciseRendererProps {
  content: ExerciseContentData
  answerSpec: import('@/contracts').AnswerSpec
  questionType: 'mcq' | 'true_false' | 'free_response'
  mode?: PreviewMode
  showCheckAnswer?: boolean
  onAnswerChange?: (answer: UserAnswer) => void
  initialAnswer?: UserAnswer
  className?: string
}
