import { describe, it, expect } from 'vitest'
import {
  applyOperation,
  applyOperations,
  equationLatex,
  frac,
  fromLinear,
  generateOptions,
  getSolution,
  getUnhelpfulReason,
  isHelpful,
  isSolvableLinear,
  operationLatex,
  solveLinear,
  substitutionCheck,
  type EquationOperation,
  type EquationState,
} from '@/server/payload/collections/Exercises/linearEquation'
import type { LinearEquation } from '@/server/payload/collections/Exercises/types'

const BASE: LinearEquation = { a: 2, b: 3, c: 1, d: 8 }

const addNumber = (n: number, d = 1): EquationOperation => ({
  kind: 'add_number',
  value: frac(n, d),
})
const addX = (n: number): EquationOperation => ({ kind: 'add_x', value: frac(n) })
const divide = (n: number): EquationOperation => ({ kind: 'divide', value: frac(n) })

/** Always taking the first helpful option must reach x = ... in a few steps. */
function solveByHelpfulOptions(linear: LinearEquation, seed: string) {
  let state: EquationState = fromLinear(linear)
  for (let step = 0; step < 6; step++) {
    if (getSolution(state)) return { state, step }
    const options = generateOptions(state, `${seed}:${step}`)
    const helpful = options.find((op) => isHelpful(state, op))
    if (!helpful) throw new Error('no helpful option')
    state = applyOperation(state, helpful)
  }
  return { state, step: 6 }
}

describe('fractions and LaTeX', () => {
  it('reduces fractions and keeps the denominator positive', () => {
    expect(frac(4, -6)).toEqual({ n: -2, d: 3 })
    expect(frac(0, -5)).toEqual({ n: 0, d: 1 })
  })

  it('formats sides, coefficients and operations', () => {
    expect(equationLatex(fromLinear(BASE))).toEqual({ left: '2x + 3', right: 'x + 8' })
    expect(equationLatex(fromLinear({ a: -1, b: 0, c: 0, d: -4 }))).toEqual({
      left: '-x',
      right: '-4',
    })
    expect(
      equationLatex(applyOperation(fromLinear({ a: 2, b: 1, c: 0, d: 4 }), divide(2))),
    ).toEqual({ left: 'x + \\frac{1}{2}', right: '2' })
    expect(operationLatex(addNumber(-3))).toBe('-3')
    expect(operationLatex(addX(-1))).toBe('-x')
    expect(operationLatex(addX(2))).toBe('+2x')
    expect(operationLatex(divide(-2))).toBe('\\div (-2)')
  })
})

describe('solving', () => {
  it('detects x on either side', () => {
    expect(getSolution(fromLinear({ a: 1, b: 0, c: 0, d: 5 }))).toEqual(frac(5))
    expect(getSolution(fromLinear({ a: 0, b: 5, c: 1, d: 0 }))).toEqual(frac(5))
    expect(getSolution(fromLinear(BASE))).toBeNull()
  })

  it('replays operations', () => {
    const state = applyOperations(BASE, [addX(-1), addNumber(-3)])
    expect(getSolution(state)).toEqual(frac(5))
  })

  it('solves directly', () => {
    expect(solveLinear(BASE)).toEqual(frac(5))
    expect(solveLinear({ a: 4, b: 1, c: 0, d: 4 })).toEqual(frac(3, 4))
  })

  it('accepts only solvable, unsolved integer equations', () => {
    expect(isSolvableLinear(BASE)).toBe(true)
    expect(isSolvableLinear({ a: 2, b: 3, c: 2, d: 8 })).toBe(false)
    expect(isSolvableLinear({ a: 1, b: 0, c: 0, d: 5 })).toBe(false)
    expect(isSolvableLinear({ a: 1.5, b: 0, c: 0, d: 5 })).toBe(false)
  })
})

describe('helpfulness', () => {
  const s = fromLinear(BASE)

  it('treats cancelling a term or isolating x as helpful', () => {
    expect(isHelpful(s, addNumber(-3))).toBe(true)
    expect(isHelpful(s, addX(-1))).toBe(true)
    expect(isHelpful(fromLinear({ a: 2, b: 0, c: 0, d: 10 }), divide(2))).toBe(true)
  })

  it('treats any move toward ax = b as helpful', () => {
    expect(isHelpful(fromLinear({ a: 2, b: -5, c: 0, d: 0 }), addNumber(5))).toBe(true)
    expect(isHelpful(fromLinear({ a: 0, b: 0, c: -1, d: 5 }), addX(1))).toBe(true)
  })

  it('treats balanced but non-simplifying moves as unhelpful', () => {
    expect(isHelpful(s, addNumber(3))).toBe(false)
    expect(isHelpful(s, addX(1))).toBe(false)
    expect(isHelpful(fromLinear({ a: 2, b: 0, c: 0, d: 10 }), divide(10))).toBe(false)
  })

  it('explains why an option did not help', () => {
    expect(getUnhelpfulReason(s, addX(1))).toBe('variable')
    expect(getUnhelpfulReason(s, addNumber(3))).toBe('number')
    expect(getUnhelpfulReason(fromLinear({ a: 2, b: 0, c: 0, d: 10 }), addNumber(4))).toBe('number')
    expect(getUnhelpfulReason(fromLinear({ a: 2, b: 0, c: 0, d: 10 }), divide(10))).toBe('divide')
  })
})

describe('generateOptions', () => {
  const EQUATIONS: LinearEquation[] = [
    BASE,
    { a: 3, b: -4, c: 0, d: 11 },
    { a: 0, b: 7, c: 2, d: -1 },
    { a: -2, b: 5, c: 3, d: 0 },
    { a: 5, b: 0, c: 0, d: 15 },
    { a: 4, b: 1, c: 0, d: 4 },
    // Tricky shapes: constant beside a lone x, and x only on the right with -1.
    { a: 2, b: -5, c: 0, d: 0 },
    { a: 0, b: 0, c: -1, d: 5 },
  ]

  it('always mixes at least one helpful and one unhelpful option', () => {
    for (const linear of EQUATIONS) {
      for (let seed = 0; seed < 25; seed++) {
        const s = fromLinear(linear)
        const options = generateOptions(s, String(seed))
        const helpful = options.filter((op) => isHelpful(s, op))
        expect(options).toHaveLength(3)
        expect(helpful.length).toBeGreaterThanOrEqual(1)
        expect(helpful.length).toBeLessThanOrEqual(2)
        expect(new Set(options.map(operationLatex)).size).toBe(3)
      }
    }
  })

  it('is deterministic per seed', () => {
    const s = fromLinear(BASE)
    expect(generateOptions(s, 'block:0:0')).toEqual(generateOptions(s, 'block:0:0'))
  })

  it('reaches x = ... by following helpful options', () => {
    for (const linear of EQUATIONS) {
      const { state, step } = solveByHelpfulOptions(linear, 'path')
      expect(getSolution(state)).toEqual(solveLinear(linear))
      expect(step).toBeLessThanOrEqual(3)
    }
  })

  it('keeps offering options after an unhelpful move', () => {
    const s = applyOperation(fromLinear(BASE), addX(1))
    const options = generateOptions(s, 'after-mistake')
    expect(options.some((op) => isHelpful(s, op))).toBe(true)
  })
})

describe('substitutionCheck', () => {
  it('plugs x into the original equation', () => {
    expect(substitutionCheck(BASE, frac(5))).toEqual({
      substituted: { left: '2 \\cdot (5) + 3', right: '(5) + 8' },
      evaluated: { left: '13', right: '13' },
      holds: true,
    })
  })

  it('handles negative coefficients and fractional x', () => {
    const check = substitutionCheck({ a: -1, b: 2, c: 3, d: 0 }, frac(1, 2))
    expect(check.substituted).toEqual({
      left: '-(\\frac{1}{2}) + 2',
      right: '3 \\cdot (\\frac{1}{2})',
    })
    expect(check.holds).toBe(true)
  })
})
