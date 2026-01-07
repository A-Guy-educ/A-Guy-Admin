/**
 * Chat Message Role Enum
 *
 * Represents the role of a message sender in an AI chat conversation.
 * Not to be confused with user roles (admin/student) in src/collections/Users/roles.ts
 */
export enum ChatMessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export function isChatMessageRole(value: unknown): value is ChatMessageRole {
  return (
    typeof value === 'string' && Object.values(ChatMessageRole).includes(value as ChatMessageRole)
  )
}
