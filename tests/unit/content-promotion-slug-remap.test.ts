/**
 * Regression tests for `computeSlugRemap` — the pure-function core of the
 * slug-collision pass. Every scenario below is one that broke or would
 * break a real content-promotion import; the units above (SlugRemap /
 * nextAvailableSuffix) cover the primitives, this file locks in the
 * behavior of the composition against actual bug shapes.
 */
import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  computeSlugRemap,
  fetchTakenSlugsForBases,
} from '@/server/services/content-promotion/import-content'
import { SlugRemap } from '@/server/services/content-promotion/id-remap'

describe('computeSlugRemap', () => {
  it('leaves a doc alone when its slug is free on target and unique in the bundle', () => {
    const remap = new SlugRemap()
    computeSlugRemap('lessons', [{ id: 'A', slug: 'foo' }], new Set(), remap)
    expect(remap.size()).toBe(0)
  })

  it('suffixes a single bundled doc whose slug is taken on target', () => {
    const remap = new SlugRemap()
    computeSlugRemap('lessons', [{ id: 'A', slug: 'foo' }], new Set(['foo']), remap)
    expect(remap.get('lessons', 'A')).toBe('foo-1')
  })

  it('regression (PR #221 body): two bundled lessons share slug, target already owns it — both get distinct suffixes', () => {
    // Real incident: bundle had two lessons titled "אחוזים" both with slug
    // "percentage-1"; target already had a different lesson at slug
    // "percentage-1". Expected: first bundled doc gets -1, second gets -2.
    const remap = new SlugRemap()
    computeSlugRemap(
      'lessons',
      [
        { id: 'A', slug: 'percentage-1' },
        { id: 'B', slug: 'percentage-1' },
      ],
      new Set(['percentage-1']),
      remap,
    )
    expect(remap.get('lessons', 'A')).toBe('percentage-1-1')
    expect(remap.get('lessons', 'B')).toBe('percentage-1-2')
  })

  it('regression (review Major #1): skips ${base}-${n} suffixes already on target — no E11000 at insert', () => {
    // Bundle: two docs both with slug "foo". Target already owns "foo-1"
    // (but not "foo"). Naive pass keeps the first doc as "foo" and hands
    // the second `foo-1` (colliding with target), which then E11000s at
    // insert. Fixed: `fetchTakenSlugsForBases` seeds `foo-1` into
    // `takenOnTarget`, so the second doc gets `foo-2`.
    const remap = new SlugRemap()
    computeSlugRemap(
      'lessons',
      [
        { id: 'A', slug: 'foo' },
        { id: 'B', slug: 'foo' },
      ],
      new Set(['foo-1']), // <— reviewer's specific case
      remap,
    )
    expect(remap.get('lessons', 'A')).toBeUndefined() // A keeps `foo` — target doesn't have it
    expect(remap.get('lessons', 'B')).toBe('foo-2')
  })

  it('manifest order determines which bundled doc keeps the base slug', () => {
    // Deterministic tie-break: whoever appears first in the manifest wins
    // the base slug. Re-exporting the same source should produce the same
    // remap, so a retry after a partial import is predictable.
    const remap = new SlugRemap()
    computeSlugRemap(
      'lessons',
      [
        { id: 'first', slug: 'foo' },
        { id: 'second', slug: 'foo' },
        { id: 'third', slug: 'foo' },
      ],
      new Set(),
      remap,
    )
    expect(remap.get('lessons', 'first')).toBeUndefined()
    expect(remap.get('lessons', 'second')).toBe('foo-1')
    expect(remap.get('lessons', 'third')).toBe('foo-2')
  })

  it('threads remaps into an existing SlugRemap rather than replacing it', () => {
    // Called once per collection during the real import — chapters first,
    // then lessons. Both must accumulate into the same map so downstream
    // `applyRemapToDoc` gets a single lookup.
    const remap = new SlugRemap()
    remap.set('chapters', 'X', 'ch-1')
    computeSlugRemap('lessons', [{ id: 'A', slug: 'foo' }], new Set(['foo']), remap)
    expect(remap.get('chapters', 'X')).toBe('ch-1')
    expect(remap.get('lessons', 'A')).toBe('foo-1')
  })
})

describe('fetchTakenSlugsForBases', () => {
  function fakePayload(collection: string, stored: Array<{ slug: string; locale?: string }>) {
    let capturedFilter: Record<string, unknown> | undefined
    const findCalls: number[] = []
    const fake = {
      db: {
        collections: {
          [collection]: {
            collection: {
              find(
                filter: Record<string, unknown>,
                _opts: { projection: Record<string, unknown> },
              ) {
                capturedFilter = filter
                findCalls.push(Date.now())
                return {
                  toArray: async () => {
                    const pattern = filter.slug as RegExp
                    const localeFilter = filter.locale as string | undefined
                    return stored
                      .filter((d) => pattern.test(d.slug))
                      .filter((d) => localeFilter === undefined || d.locale === localeFilter)
                      .map(({ slug }) => ({ slug }))
                  },
                }
              },
            },
          },
        },
      },
    }
    return { fake, getCapturedFilter: () => capturedFilter, findCalls }
  }

  it('returns the empty set for zero bases without touching the DB', async () => {
    const { fake, findCalls } = fakePayload('lessons', [{ slug: 'anything' }])
    const result = await fetchTakenSlugsForBases(fake as unknown as Payload, 'lessons', [])
    expect(result.size).toBe(0)
    expect(findCalls.length).toBe(0)
  })

  it('matches exact bases AND ${base}-${n} suffixes — the whole point of the review fix', async () => {
    const { fake } = fakePayload(
      'lessons',
      [
        'foo',
        'foo-1',
        'foo-17',
        'foobar', // NOT a suffix — regex is anchored, must not match
        'bar-3',
        'baz', // unrelated
      ].map((slug) => ({ slug })),
    )
    const result = await fetchTakenSlugsForBases(fake as unknown as Payload, 'lessons', [
      'foo',
      'bar',
    ])
    expect([...result].sort()).toEqual(['bar-3', 'foo', 'foo-1', 'foo-17'])
  })

  it('escapes regex metacharacters in bases so a slug like "a.b" is treated literally', async () => {
    // Realistic guard: if slug ever contains `.`, `+`, `?` etc., the raw
    // regex would over-match. Escaping is the reason `foo.bar` doesn't
    // match `fooXbar` on target.
    const { fake } = fakePayload(
      'lessons',
      ['fooXbar', 'foo.bar', 'foo.bar-2'].map((slug) => ({ slug })),
    )
    const result = await fetchTakenSlugsForBases(fake as unknown as Payload, 'lessons', ['foo.bar'])
    expect([...result].sort()).toEqual(['foo.bar', 'foo.bar-2'])
  })

  it('passes additionalFilter through to the underlying find — used for per-locale course scoping', async () => {
    // Regression for the course-slug-locale incident: bundled course
    // `slug=course-8 locale=en` must not treat a dev doc at
    // `slug=course-8 locale=he` as taken. The extra filter is the reason.
    const { fake, getCapturedFilter } = fakePayload('courses', [
      { slug: 'course-8', locale: 'he' },
      { slug: 'course-8', locale: 'en' },
      { slug: 'course-8-1', locale: 'he' },
    ])
    const enOnly = await fetchTakenSlugsForBases(
      fake as unknown as Payload,
      'courses',
      ['course-8'],
      { locale: 'en' },
    )
    expect([...enOnly].sort()).toEqual(['course-8'])
    expect(getCapturedFilter()?.locale).toBe('en')

    const heOnly = await fetchTakenSlugsForBases(
      fake as unknown as Payload,
      'courses',
      ['course-8'],
      { locale: 'he' },
    )
    expect([...heOnly].sort()).toEqual(['course-8', 'course-8-1'])
  })
})
