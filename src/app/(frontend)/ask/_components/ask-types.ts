export interface ExerciseFile {
  id: number
  title: string
  url: string
  date: string
}

export interface AskActionEvent {
  type: 'hint' | 'solution' | 'check'
  title: string
  imageData?: string
}

export const ASK_ACTION_EVENT = 'ask-action' as const
