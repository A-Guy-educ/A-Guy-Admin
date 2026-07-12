// @vitest-environment jsdom

import '@testing-library/jest-dom'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fieldValue: '',
  setModified: vi.fn(),
  setValue: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@payloadcms/ui', () => ({
  useField: () => ({ value: mocks.fieldValue, setValue: mocks.setValue }),
  useForm: () => ({ setModified: mocks.setModified }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))

vi.mock('@/ui/admin/LessonBlocksField/InlineExerciseEditor', async () => {
  const React = await import('react')

  return {
    InlineExerciseEditor: ({
      exerciseId,
      exerciseTitle,
    }: {
      exerciseId: string
      exerciseTitle?: string
    }) =>
      React.createElement(
        'div',
        { 'data-testid': `inline-exercise-${exerciseId}` },
        exerciseTitle ?? 'Inline exercise',
      ),
  }
})

import { LessonBlocksField } from '@/ui/admin/LessonBlocksField/index'

const exerciseBlockValue = JSON.stringify([
  { id: 'block-1', blockType: 'exerciseRef', exercise: 'exercise-123' },
])

let intersectionCallback: IntersectionObserverCallback | undefined
let observer: IntersectionObserver

const installIntersectionObserver = () => {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = []

    disconnect = vi.fn()
    observe = vi.fn()
    takeRecords = vi.fn(() => [])
    unobserve = vi.fn()

    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback
      observer = this
    }
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
}

const triggerIntersection = (isIntersecting: boolean) => {
  expect(intersectionCallback).toBeDefined()
  intersectionCallback?.([{ isIntersecting } as IntersectionObserverEntry], observer)
}

const stubFetchSuccess = (title: string) => {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title }),
    } as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const stubFetchFailure = () => {
  const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  mocks.fieldValue = exerciseBlockValue
  mocks.routerPush.mockReset()
  mocks.setModified.mockReset()
  mocks.setValue.mockReset()
  intersectionCallback = undefined
  installIntersectionObserver()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LessonBlocksField lazy activation', () => {
  it('shows a placeholder and does not fetch exercise titles before activation', () => {
    const fetchMock = stubFetchSuccess('Fetched Exercise')

    render(<LessonBlocksField path="blocks" />)

    expect(screen.getByText('Loading exercises…')).toBeInTheDocument()
    expect(screen.queryByTestId('inline-exercise-exercise-123')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches titles and renders rows after the field becomes visible', async () => {
    const fetchMock = stubFetchSuccess('Fetched Exercise')

    render(<LessonBlocksField path="blocks" />)

    act(() => triggerIntersection(true))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/exercises/exercise-123?depth=0', {
        credentials: 'include',
      })
    })
    await waitFor(() => expect(screen.getAllByText('Fetched Exercise').length).toBeGreaterThan(0))
    expect(screen.getByTestId('inline-exercise-exercise-123')).toBeInTheDocument()
  })

  it('keeps activation sticky and does not refetch when visibility toggles again', async () => {
    const fetchMock = stubFetchSuccess('Fetched Exercise')

    render(<LessonBlocksField path="blocks" />)

    act(() => triggerIntersection(true))
    await waitFor(() => expect(screen.getAllByText('Fetched Exercise').length).toBeGreaterThan(0))

    act(() => {
      triggerIntersection(false)
      triggerIntersection(true)
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Loading exercises…')).toBeNull()
  })

  it('shows the fallback title when title resolution fails after activation', async () => {
    stubFetchFailure()

    render(<LessonBlocksField path="blocks" />)

    act(() => triggerIntersection(true))

    await waitFor(() => expect(screen.getAllByText('(exercise...)').length).toBeGreaterThan(0))
  })
})
