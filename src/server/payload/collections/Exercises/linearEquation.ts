/**
 * Engine for the dynamic `question_equation` mode: exact fraction arithmetic
 * on `a·x + b = c·x + d`, operation options generated from the current line,
 * and LaTeX output for the notebook.
 */
import type { EquationSides, LinearEquation } from './types'

/** Reduced fraction n/d with d > 0. */
export interface Fraction {
  n: number
  d: number
}

/** Coefficients of `a·x + b = c·x + d`. */
export interface EquationState {
  a: Fraction
  b: Fraction
  c: Fraction
  d: Fraction
}

/** An operation applied to both sides. */
export interface EquationOperation {
  kind: 'add_number' | 'add_x' | 'divide'
  value: Fraction
}

/** Why an option did not help, used to pick the note shown to the student. */
export type UnhelpfulReason = 'variable' | 'number' | 'divide' | 'clear'

export const EQUATION_OPTION_COUNT = 3

// ---------------------------------
// Fractions
// ---------------------------------
function gcd(x: number, y: number): number {
  let [p, q] = [Math.abs(x), Math.abs(y)]
  while (q) [p, q] = [q, p % q]
  return p || 1
}

export function frac(n: number, d = 1): Fraction {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) {
    throw new Error(`Invalid fraction ${n}/${d}`)
  }
  const sign = d < 0 ? -1 : 1
  const g = gcd(n, d)
  // `+ 0` normalizes -0 so equality checks stay simple.
  return { n: (sign * n) / g + 0, d: Math.abs(d) / g }
}

const add = (x: Fraction, y: Fraction) => frac(x.n * y.d + y.n * x.d, x.d * y.d)
const mul = (x: Fraction, y: Fraction) => frac(x.n * y.n, x.d * y.d)
const div = (x: Fraction, y: Fraction) => frac(x.n * y.d, x.d * y.n)
const neg = (x: Fraction) => frac(-x.n, x.d)
const abs = (x: Fraction) => frac(Math.abs(x.n), x.d)
const isZero = (x: Fraction) => x.n === 0
const isOne = (x: Fraction) => x.n === 1 && x.d === 1
export const fractionsEqual = (x: Fraction, y: Fraction) => x.n === y.n && x.d === y.d

// ---------------------------------
// Equation state
// ---------------------------------
export function fromLinear({ a, b, c, d }: LinearEquation): EquationState {
  return { a: frac(a), b: frac(b), c: frac(c), d: frac(d) }
}

export function applyOperation(s: EquationState, op: EquationOperation): EquationState {
  if (op.kind === 'divide') {
    return {
      a: div(s.a, op.value),
      b: div(s.b, op.value),
      c: div(s.c, op.value),
      d: div(s.d, op.value),
    }
  }
  if (op.kind === 'add_x') return { ...s, a: add(s.a, op.value), c: add(s.c, op.value) }
  return { ...s, b: add(s.b, op.value), d: add(s.d, op.value) }
}

export function applyOperations(
  linear: LinearEquation,
  operations: readonly EquationOperation[],
): EquationState {
  return operations.reduce(applyOperation, fromLinear(linear))
}

/** The value of x once it stands alone (`x = k` or `k = x`), otherwise null. */
export function getSolution(s: EquationState): Fraction | null {
  if (isOne(s.a) && isZero(s.b) && isZero(s.c)) return s.d
  if (isOne(s.c) && isZero(s.d) && isZero(s.a)) return s.b
  return null
}

/** Authoring check: integers, a unique solution, and at least one step to take. */
export function isSolvableLinear(linear: LinearEquation): boolean {
  const values = [linear.a, linear.b, linear.c, linear.d]
  if (!values.every(Number.isInteger)) return false
  return linear.a !== linear.c && getSolution(fromLinear(linear)) === null
}

/** x for an equation that passes `isSolvableLinear`. */
export function solveLinear({ a, b, c, d }: LinearEquation): Fraction {
  return frac(d - b, a - c)
}

/**
 * Steps left to isolate x on one side: move the other side's x term, clear
 * this side's constant, divide by the coefficient. Best of both sides.
 */
function stepsLeft(s: EquationState): number {
  const need = (x: Fraction, constant: Fraction, otherX: Fraction) =>
    Number(!isZero(otherX)) + Number(!isZero(constant)) + Number(!isOne(add(x, neg(otherX))))
  return Math.min(need(s.a, s.b, s.c), need(s.c, s.d, s.a))
}

/** An operation helps when it brings x = k closer. */
export function isHelpful(s: EquationState, op: EquationOperation): boolean {
  return stepsLeft(applyOperation(s, op)) < stepsLeft(s)
}

/** The coefficient of x when x stands alone with no constant beside it. */
function loneCoefficient(s: EquationState): Fraction | null {
  if (isZero(s.b) && isZero(s.c) && !isZero(s.a)) return s.a
  if (isZero(s.d) && isZero(s.a) && !isZero(s.c)) return s.c
  return null
}

export function getUnhelpfulReason(s: EquationState, op: EquationOperation): UnhelpfulReason {
  if (op.kind === 'add_x') return 'variable'
  const lone = loneCoefficient(applyOperation(s, op))
  if (lone && !isOne(lone)) return 'divide'
  return op.kind === 'add_number' ? 'number' : 'clear'
}

// ---------------------------------
// Options
// ---------------------------------
const addNumber = (value: Fraction): EquationOperation => ({ kind: 'add_number', value })
const addX = (value: Fraction): EquationOperation => ({ kind: 'add_x', value })
const divide = (value: Fraction): EquationOperation => ({ kind: 'divide', value })

const sameOperation = (x: EquationOperation, y: EquationOperation) =>
  x.kind === y.kind && fractionsEqual(x.value, y.value)

function uniqueValid(ops: EquationOperation[]): EquationOperation[] {
  return ops.reduce<EquationOperation[]>((acc, op) => {
    if (isZero(op.value) || acc.some((o) => sameOperation(o, op))) return acc
    return [...acc, op]
  }, [])
}

function helpfulCandidates(s: EquationState): EquationOperation[] {
  const lone = loneCoefficient(s)
  return uniqueValid([
    addNumber(neg(s.b)),
    addNumber(neg(s.d)),
    addX(neg(s.c)),
    addX(neg(s.a)),
    ...(lone && !isOne(lone) ? [divide(lone)] : []),
  ]).filter((op) => isHelpful(s, op))
}

/** Common mistakes first (wrong sign, dividing by the wrong number). */
function plausibleMistakes(s: EquationState): EquationOperation[] {
  const lone = loneCoefficient(s)
  const constant = lone && (isZero(s.b) ? s.d : s.b)
  return [
    addNumber(s.b),
    addNumber(s.d),
    addX(s.a),
    addX(s.c),
    ...(lone ? [addNumber(neg(lone)), divide(neg(lone))] : []),
    ...(constant ? [divide(constant)] : []),
  ]
}

const GENERIC_MISTAKES: EquationOperation[] = [
  ...[1, 2, 3, 4, 5].flatMap((n) => [addNumber(frac(n)), addNumber(frac(-n))]),
  ...[1, 2].flatMap((n) => [addX(frac(n)), addX(frac(-n))]),
]

/** Deterministic PRNG so server and client render the same options. */
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  return items
    .map((item) => ({ item, key: random() }))
    .sort((x, y) => x.key - y.key)
    .map(({ item }) => item)
}

/**
 * Pick the options for the current line: at least one helpful and at least
 * one unhelpful operation, the rest drawn at random from both, shuffled.
 */
export function generateOptions(
  s: EquationState,
  seed: string,
  count = EQUATION_OPTION_COUNT,
): EquationOperation[] {
  const random = seededRandom(seed)
  const helpful = shuffle(helpfulCandidates(s), random)
  const unhelpful = uniqueValid([
    ...shuffle(plausibleMistakes(s), random),
    ...shuffle(GENERIC_MISTAKES, random),
  ]).filter((op) => !isHelpful(s, op) && !helpful.some((h) => sameOperation(h, op)))

  const [firstHelpful, ...restHelpful] = helpful
  const [firstUnhelpful, ...restUnhelpful] = unhelpful
  const rest = [...restHelpful, ...restUnhelpful.slice(0, count)]
  const extra = shuffle(rest, random).slice(0, count - 2)
  return shuffle([firstHelpful, firstUnhelpful, ...extra].filter(Boolean), random)
}

// ---------------------------------
// LaTeX
// ---------------------------------
export function fractionLatex(x: Fraction): string {
  const sign = x.n < 0 ? '-' : ''
  const magnitude = Math.abs(x.n)
  return x.d === 1 ? `${sign}${magnitude}` : `${sign}\\frac{${magnitude}}{${x.d}}`
}

/** Coefficient in front of x: `x`, `-x`, `2x`, `\frac{1}{2}x`. */
function xTermLatex(coefficient: Fraction): string {
  const sign = coefficient.n < 0 ? '-' : ''
  const magnitude = abs(coefficient)
  return `${sign}${isOne(magnitude) ? '' : fractionLatex(magnitude)}x`
}

function sideLatex(coefficient: Fraction, constant: Fraction): string {
  if (isZero(coefficient)) return fractionLatex(constant)
  const x = xTermLatex(coefficient)
  if (isZero(constant)) return x
  return `${x} ${constant.n < 0 ? '-' : '+'} ${fractionLatex(abs(constant))}`
}

export function equationLatex(s: EquationState): EquationSides {
  return { left: sideLatex(s.a, s.b), right: sideLatex(s.c, s.d) }
}

export function linearToSides(linear: LinearEquation): EquationSides {
  return equationLatex(fromLinear(linear))
}

export function operationLatex(op: EquationOperation): string {
  if (op.kind === 'divide') {
    const value = fractionLatex(op.value)
    return `\\div ${op.value.n < 0 ? `(${value})` : value}`
  }
  const sign = op.value.n < 0 ? '-' : '+'
  const magnitude = abs(op.value)
  if (op.kind === 'add_x') return `${sign}${isOne(magnitude) ? '' : fractionLatex(magnitude)}x`
  return `${sign}${fractionLatex(magnitude)}`
}

// ---------------------------------
// Substitution check
// ---------------------------------
function substitutedSide(coefficient: Fraction, constant: Fraction, x: Fraction): string {
  const value = `(${fractionLatex(x)})`
  let term = `${fractionLatex(coefficient)} \\cdot ${value}`
  if (isZero(coefficient)) term = ''
  else if (isOne(coefficient)) term = value
  else if (isOne(neg(coefficient))) term = `-${value}`
  if (!term) return fractionLatex(constant)
  if (isZero(constant)) return term
  return `${term} ${constant.n < 0 ? '-' : '+'} ${fractionLatex(abs(constant))}`
}

export interface SubstitutionCheck {
  substituted: EquationSides
  evaluated: EquationSides
  holds: boolean
}

/** Plug x into the original equation: the substituted line and both values. */
export function substitutionCheck(linear: LinearEquation, x: Fraction): SubstitutionCheck {
  const s = fromLinear(linear)
  const left = add(mul(s.a, x), s.b)
  const right = add(mul(s.c, x), s.d)
  return {
    substituted: {
      left: substitutedSide(s.a, s.b, x),
      right: substitutedSide(s.c, s.d, x),
    },
    evaluated: { left: fractionLatex(left), right: fractionLatex(right) },
    holds: fractionsEqual(left, right),
  }
}
