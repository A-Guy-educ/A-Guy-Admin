// @vitest-environment jsdom
/**
 * @fileType unit-test
 * @domain admin
 * @pattern section-navigation, sibling-switcher
 * @ai-summary Verifies SectionNavigation renders the full chain and offers
 *             prev/next sibling switching.
 */
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'

const formValues: Record<string, unknown> = { exercise: 'ex-1' }
let documentId: string | null = 'sec-1'
const fetchMock = vi.fn()

vi.mock('@/ui/shared/providers/I18n', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ id: documentId, collection: { slug: 'sections' } }),
  useFormFields: <T,>(
    selector: (context: [Record<string, { value: unknown }>, unknown]) => T,
  ): T => {
    const fields = Object.fromEntries(
      Object.entries(formValues).map(([k, v]) => [k, { value: v, initialValue: v }]),
    )
    return selector([fields, () => undefined])
  },
}))

function ok(payload: unknown) {
  return { ok: true, json: async () => payload }
}

const EXERCISE_FULL = { id: 'ex-1', title: 'Exercise Title', lesson: 'les-1' }
const LESSON_FULL = {
  id: 'les-1',
  title: 'Lesson Title',
  chapter: 'cha-1',
}
const CHAPTER_FULL = {
  id: 'cha-1',
  title: 'Chapter Title',
  chapterLabel: 'C1',
  course: 'cou-1',
}
const COURSE_FULL = { id: 'cou-1', title: 'Course Title', courseLabel: 'COURSE' }

function setupFetch() {
  fetchMock.mockImplementation(async (url: string) => {
    // Relationship-only fetches (select[field]=true) — checked first so the
    // catch-all label-record match below does not swallow them.
    if (url.includes('select%5Blesson%5D') || url.includes('select[lesson]')) {
      return ok({ lesson: 'les-1' })
    }
    if (url.includes('select%5Bchapter%5D') || url.includes('select[chapter]')) {
      return ok({ chapter: 'cha-1' })
    }
    if (url.includes('select%5Bcourse%5D') || url.includes('select[course]')) {
      return ok({ course: 'cou-1' })
    }

    // fetchRecord calls — full label-bearing record.
    if (url.includes('/api/exercises/ex-1')) {
      return ok({ ...EXERCISE_FULL, adminTitle: 'Exercise Title' })
    }
    if (url.includes('/api/lessons/les-1')) {
      return ok(LESSON_FULL)
    }
    if (url.includes('/api/chapters/cha-1')) {
      return ok(CHAPTER_FULL)
    }
    if (url.includes('/api/courses/cou-1')) {
      return ok(COURSE_FULL)
    }
    if (url.includes('/api/sections/sec-1')) {
      return ok({ id: 'sec-1', title: 'Current Section' })
    }
    if (url.includes('/api/sections?depth=0')) {
      return ok({
        docs: [
          { id: 'sec-0', title: 'Prev Section' },
          { id: 'sec-1', title: 'Current Section' },
          { id: 'sec-2', title: 'Next Section' },
        ],
      })
    }
    return ok({})
  })
}

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  formValues.exercise = 'ex-1'
  documentId = 'sec-1'
  fetchMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('SectionNavigation', () => {
  it('renders the full course / chapter / lesson / exercise / section chain', async () => {
    setupFetch()
    const { SectionNavigation } = await import('@/ui/admin/ContentNavigation')
    render(<SectionNavigation />)

    const breadcrumb = await screen.findByLabelText('Content hierarchy breadcrumb')
    await waitFor(() => {
      expect(within(breadcrumb).getByText('Course Title')).toBeInTheDocument()
    })
    expect(within(breadcrumb).getByText('Chapter Title')).toBeInTheDocument()
    expect(within(breadcrumb).getByText('Lesson Title')).toBeInTheDocument()
    expect(within(breadcrumb).getByText('Exercise Title')).toBeInTheDocument()
  })

  it('renders a sibling-section switcher with prev/next targets', async () => {
    setupFetch()
    const { SectionNavigation } = await import('@/ui/admin/ContentNavigation')
    render(<SectionNavigation />)

    const prevLink = await screen.findByRole('link', { name: /Prev Section/ })
    const nextLink = await screen.findByRole('link', { name: /Next Section/ })

    expect(prevLink).toHaveAttribute('href', '/admin/collections/sections/sec-0')
    expect(nextLink).toHaveAttribute('href', '/admin/collections/sections/sec-2')
  })

  it('falls back to "Not assigned" labels when the parent exercise is unset', async () => {
    setupFetch()
    formValues.exercise = null
    const { SectionNavigation } = await import('@/ui/admin/ContentNavigation')
    render(<SectionNavigation />)

    await waitFor(() => {
      expect(screen.getAllByText('Not assigned').length).toBeGreaterThan(0)
    })
  })
})
