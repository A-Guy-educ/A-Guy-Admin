/**
 * Answer-text normalization for the MCQ correct-option rule.
 *
 * The correctness check compares "the marked option's text" vs "the solution
 * text". Both are authored in Hebrew markdown-math with quirks like `$3$`,
 * unicode minus signs, comma thousand-separators, curly braces around
 * fractions, etc. We want the check to pass when the two forms mean the
 * same thing, and fail when they don't.
 *
 * Strategy: strip cosmetic wrappers ($..$, whitespace, thousand commas,
 * currency labels), unify minus signs, then compare. This is intentionally
 * conservative — we'd rather miss a real bug (false negative) than flag a
 * correctly-authored lesson (false positive).
 */

const MINUS_LIKE = /[‐-―−]/g // various dash characters → ASCII hyphen
const LATEX_TEXT_STRIP = /\\text\{([^}]*)\}/g
const LATEX_MATHRM_STRIP = /\\mathrm\{([^}]*)\}/g

export function normalizeAnswer(raw: string): string {
  if (!raw) return ''

  let s = raw

  // Strip inline math delimiters — the same value can appear as `$3$` or `3`.
  s = s.replace(/\$/g, '')

  // Strip LaTeX `\text{…}` and `\mathrm{…}` wrappers, keeping their content.
  s = s.replace(LATEX_TEXT_STRIP, '$1')
  s = s.replace(LATEX_MATHRM_STRIP, '$1')

  // Normalize LaTeX fraction to a simple `a/b` form so `\frac{3}{2}` matches
  // an author-written `3/2`. Only handles single-brace numerators/denominators.
  s = s.replace(/\\d?frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, '($1)/($2)')

  // Unicode minus / en-dash / em-dash → ASCII hyphen.
  s = s.replace(MINUS_LIKE, '-')

  // Remove thousand separators inside numbers: `11,000` → `11000`.
  // Only strip commas between digits — leave list separators alone.
  s = s.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')

  // Drop currency labels the boss's team uses inconsistently (`ש"ח`, `שקל`).
  s = s.replace(/ש["״']ח/g, '').replace(/שקל(ים)?/g, '')

  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

/**
 * Semantic equality between two answer strings. Returns true when both
 * normalize to the same form.
 */
export function answersEqual(a: string, b: string): boolean {
  return normalizeAnswer(a) === normalizeAnswer(b)
}
