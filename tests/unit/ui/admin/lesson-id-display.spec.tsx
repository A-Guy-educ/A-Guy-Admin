// @vitest-environment jsdom

import '@testing-library/jest-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  documentId: undefined as string | number | undefined,
}))

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ id: mocks.documentId }),
}))

import { LessonIdDisplay } from '@/ui/admin/LessonIdDisplay'

beforeEach(() => {
  mocks.documentId = undefined
})

afterEach(() => {
  cleanup()
})

describe('LessonIdDisplay', () => {
  it('renders the current lesson id in a read-only monospace input', () => {
    mocks.documentId = '507f1f77bcf86cd799439011'

    render(<LessonIdDisplay />)

    const input = screen.getByLabelText('Lesson ID')
    expect(input).toHaveValue('507f1f77bcf86cd799439011')
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveClass('font-mono')
  })

  it('shows an unsaved placeholder without inventing an id', () => {
    render(<LessonIdDisplay />)

    expect(screen.getByLabelText('Lesson ID')).toHaveValue('Available after first save')
  })
})
