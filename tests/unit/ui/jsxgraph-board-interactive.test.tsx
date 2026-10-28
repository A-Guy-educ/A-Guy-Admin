/**
 * @fileType unit-test
 * @domain exercises
 * @pattern ui-test, jsxgraph-board
 * @ai-summary Verifies interactive={false} boards are created without JSXGraph event handlers
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'

const initBoard = vi.fn((_container: unknown, _options: Record<string, unknown>) => ({
  create: vi.fn(),
}))

vi.mock('jsxgraph', () => ({
  default: { JSXGraph: { initBoard, freeBoard: vi.fn() } },
}))

import { JSXGraphBoard } from '@/ui/shared/exerciserenderer/graphics/JSXGraphBoard'

function renderBoard(interactive?: boolean) {
  return render(
    <JSXGraphBoard
      id="b1"
      width={300}
      height={300}
      onBoardReady={() => {}}
      {...(interactive === undefined ? {} : { interactive })}
    />,
  )
}

describe('JSXGraphBoard interactive flag', () => {
  beforeEach(() => initBoard.mockClear())

  // CSS pointer-events on the container does not stop JSXGraph's own hit-testing
  // (hover highlight + coordinates infobox), so the flag must reach initBoard.
  it('disables JSXGraph event registration when interactive is false', async () => {
    renderBoard(false)
    await waitFor(() => expect(initBoard).toHaveBeenCalledTimes(1))
    expect(initBoard.mock.calls[0][1]).toMatchObject({ registerEvents: false })
  })

  it('keeps JSXGraph events by default', async () => {
    renderBoard()
    await waitFor(() => expect(initBoard).toHaveBeenCalledTimes(1))
    expect(initBoard.mock.calls[0][1]).not.toHaveProperty('registerEvents')
  })
})
