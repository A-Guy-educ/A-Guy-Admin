// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * @fileType unit-test
 * @domain admin, lesson-studio
 * @pattern outside-click, portal-drawer
 * @ai-summary StudioDocBlock keeps its editor open while a Payload drawer (media picker) is in use
 */

vi.mock('@/ui/admin/LessonStudio/LazyInlineBlockEditor', () => ({
  LazyInlineBlockEditor: () => <div data-testid="inline-editor" />,
  prefetchInlineBlockEditor: () => {},
}))

import { StudioDocBlock } from '@/ui/admin/LessonStudio/StudioDocBlock'

describe('StudioDocBlock outside-click', () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  function openEditor() {
    render(<StudioDocBlock block={{ id: 'm1', type: 'media', mediaId: '' }} onChange={() => {}} />)
    fireEvent.click(screen.getByText('Click to edit'))
    expect(screen.getByTestId('inline-editor')).toBeTruthy()
  }

  it('stays in edit mode when clicking inside a Payload drawer portal', () => {
    openEditor()

    const container = document.createElement('div')
    container.className = 'payload__modal-container'
    const row = document.createElement('button')
    container.appendChild(row)
    document.body.appendChild(container)

    fireEvent.mouseDown(row)

    expect(screen.queryByTestId('inline-editor')).toBeTruthy()
  })

  it('still closes the editor on a genuine outside click', () => {
    openEditor()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByTestId('inline-editor')).toBeNull()
  })
})
