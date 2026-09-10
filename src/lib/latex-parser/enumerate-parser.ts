/**
 * Parses \begin{enumerate}[label=\alph*.] environments into question blocks.
 *
 * Bagrut exam pattern:
 *   \begin{enumerate}[label=\textbf{\alph*.}]
 *   \item question text a
 *   \item question text b
 *   \end{enumerate}
 *
 * Also handles start= option for continuation:
 *   \begin{enumerate}[label=\textbf{\alph*.}, start=2]
 */

import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { makeFreeResponseBlock, makeRichTextBlock } from '@/lib/latex-parser/block-generators'

/** Extract the start index from enumerate options like [label=\alph*., start=3] */
function parseStartIndex(envContent: string): number {
  const startMatch = /start=(\d+)/.exec(envContent)
  return startMatch ? parseInt(startMatch[1], 10) : 1
}

/**
 * Detect if this enumerate is a top-level exercise list.
 * Must use \arabic*. label (with period, not parens) AND have large itemsep.
 * This distinguishes exercise lists from MCQ sub-options.
 */
function isExerciseEnumerate(envContent: string): boolean {
  // Must have \arabic*. or \arabic* followed by a period in the label
  const hasArabicLabel = /label\s*=\s*\\textbf\{\\arabic\*\.\}/.test(envContent)
  // Large itemsep indicates exercise-level spacing (>= 1cm)
  const hasLargeSpacing = /itemsep\s*=\s*(1(\.\d+)?|[2-9](\.\d+)?)\s*cm/.test(envContent)
  return hasArabicLabel && hasLargeSpacing
}

/** Convert a 1-based index to a label (a, b, c...) — kept for potential future use */
function _indexToLabel(index: number): string {
  return String.fromCharCode(96 + index) // 1->a, 2->b, etc.
}

/**
 * HTML-comment marker prepended to a question's prompt so `deriveSectionTitle`
 * can override the default `סעיף {letter}` label with an explicit one (e.g.,
 * `סעיף ג1` for a nested sub-item). HTML comments are hidden by markdown
 * renderers and `partitionBlocks` strips the marker before persistence.
 */
export const SECTION_TITLE_MARKER_RE = /^<!--SEC:([^>]+?)-->\n?/

function sectionTitleMarker(label: string): string {
  return `<!--SEC:${label}-->\n`
}

const HEB_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ל', 'מ', 'נ']
function hebrewLetter(oneBasedIndex: number): string {
  return HEB_LETTERS[oneBasedIndex - 1] ?? String(oneBasedIndex)
}

/** Find matching closing brace with nesting support. */
function findMatchingBrace(text: string, openPos: number): number {
  let depth = 1
  for (let i = openPos + 1; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Strip {\color{...} content} groups using brace counting
 * to handle nested braces like \frac{1}{...}.
 */
function stripColorAndSizing(text: string): string {
  let result = text
  let i = 0
  let output = ''
  while (i < result.length) {
    if (result[i] === '{') {
      const after = result.slice(i + 1)
      const cmdMatch =
        /^\\(?:Large|large|huge|Huge)\s*\\color\{[^}]*\}\s*/.exec(after) ||
        /^\\color\{[^}]*\}\s*/.exec(after) ||
        /^\\(?:Large|large|huge|Huge)\s*/.exec(after)
      if (cmdMatch) {
        const closingBrace = findMatchingBrace(result, i)
        if (closingBrace > i) {
          output += result.slice(i + 1 + cmdMatch[0].length, closingBrace)
          i = closingBrace + 1
          continue
        }
      }
    }
    output += result[i]
    i++
  }
  result = output
    .replace(/\\(?:Large|large|huge|Huge|normalsize|small|footnotesize|tiny)\s*/g, '')
    .replace(/\\color\{[^}]*\}/g, '')
    .replace(/\\definecolor\{[^}]*\}\{[^}]*\}\{[^}]*\}/g, '')
  return result
}

/** Clean LaTeX formatting from item text */
function cleanItemText(text: string): string {
  return (
    stripColorAndSizing(text)
      // Convert \begin{itemize}...\end{itemize} to bullet points
      .replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_match, inner: string) => {
        const items = inner.split(/\\item\s*/).filter((s: string) => s.trim())
        return items.map((item: string) => `\n• ${item.trim()}`).join('')
      })
      // Strip leaked environment tags
      .replace(
        /\\(?:begin|end)\{(?:enumerate|center|itemize|tabular\*?|tcolorbox)\}(?:\[[^\]]*\])?/g,
        '',
      )
      .replace(/\\selectlanguage\{[^}]*\}/g, '')
      // Strip tikzpicture blocks that leaked into items
      .replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, '')
      // Strip [(N)] labels that survived pre-processing
      .replace(/^\[\(?\d+\)?\]\s*/g, '')
      .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
      .replace(/\\textit\{([^}]*)\}/g, '*$1*')
      .replace(/\\emph\{([^}]*)\}/g, '*$1*')
      .replace(/\\(?:underline|underbar)\{([^}]*)\}/g, '$1')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\\\/g, ' ')
      .replace(/\\vspace\{[^}]*\}/g, ' ')
      .replace(/\\hspace\*?\{[^}]*\}/g, ' ')
      .replace(/\\noindent/g, '')
      // Collapse whitespace into single spaces
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Parses the inner content of an enumerate environment into content blocks.
 * Each \item becomes a question_free_response block.
 *
 * Supports two label styles:
 *   - label=\alph*. with optional start=N  →  auto-generated a, b, c labels
 *   - \item[\textbf{א.}] explicit Hebrew labels
 */
export function parseEnumerate(innerContent: string): ContentBlock[] {
  const blocks: ContentBlock[] = []

  // Extract start index from the enumerate options (if present in the raw env text)
  const startIndex = parseStartIndex(innerContent)
  const isNumbered = isExerciseEnumerate(innerContent)

  // Pre-process: convert nested environments to inline text
  // before splitting on \item, to avoid splitting inside nested environments
  let preprocessed = innerContent
  // Convert \begin{itemize}...\end{itemize} to inline bullet text
  preprocessed = preprocessed.replace(
    /\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g,
    (_match, inner: string) => {
      const items = inner.split(/\\item\s*/).filter((s: string) => s.trim())
      return items.map((item: string) => `\n(${item.trim()})`).join(' ')
    },
  )
  // Convert nested `\begin{enumerate}[label=...]...\end{enumerate}` to inline
  // `(N) …` markers so the outer split on `\item` doesn't shred through the
  // nested structure. Downstream the outer parent picks up these markers via
  // the inline-`(N)` sub-item handler and emits `סעיף {parent}{n}` sections.
  //
  // Matches both MCQ sub-options `[label=(\textbf{\arabic*})]` and plain
  // numeric sub-items `[label=\arabic*.]` / `[label=(\arabic*)]` /
  // `[label=\Roman*.]` / `[label=\alph*.]`.
  preprocessed = preprocessed.replace(
    /\\begin\{enumerate\}\s*\[label=(?:\(?\\textbf\{[^}]*\}\)?|\(?\\(?:arabic|Roman|roman|Alph|alph)\*\)?[.:)]?)[^\]]*\]([\s\S]*?)\\end\{enumerate\}/g,
    (_match, inner: string) => {
      const items = inner.split(/\\item\s*/).filter((s: string) => s.trim())
      return items.map((item: string, idx: number) => `\n(${idx + 1}) ${item.trim()}`).join('')
    },
  )

  // Split on \item markers (word-boundary so \itemindent etc. don't match)
  const parts = preprocessed.split(/\\item(?![a-zA-Z])/)

  // Non-empty items only — parent-letter counter is over these so labels
  // match the PDF (empty \item's skipped, no gaps in א/ב/ג/...).
  const nonEmpty: string[] = []
  for (let i = 1; i < parts.length; i++) {
    const t = parts[i].trim()
    if (t) nonEmpty.push(t)
  }

  for (let parentIdx = 0; parentIdx < nonEmpty.length; parentIdx++) {
    const raw = nonEmpty[parentIdx]
    const parentLetter = hebrewLetter(parentIdx + 1)

    // Strip explicit label at the start:
    //   [\textbf{א.}]  [\textbf{(1)}]  [(1)]  [(א)]  [א.]
    const explicitLabelMatch =
      /^\[\\textbf\{([^}]*)\}\]\s*/.exec(raw) || /^\[\(?[\u0590-\u05FFa-z\d]+\.?\)?\]\s*/.exec(raw)
    const content = explicitLabelMatch ? raw.slice(explicitLabelMatch[0].length).trim() : raw

    // Numbered top-level exercise (\arabic*. label) — emit heading + item,
    // no section-label marker. parseLatexToExercises splits on `## תרגיל N`.
    if (isNumbered) {
      const num = startIndex + parentIdx
      blocks.push(makeRichTextBlock(`## תרגיל ${num}`))
      const cleanedTop = cleanItemText(content)
      if (cleanedTop) blocks.push(makeFreeResponseBlock(cleanedTop))
      continue
    }

    // Nested numbered enumerate inside this parent item — each nested `\item`
    // becomes its own section labeled `סעיף {parent}{n}` (e.g. `ג1`, `ג2`).
    // Matches both `\arabic*` and `\Roman*` labels with or without wrapping
    // parens, so `[label=\arabic*.]`, `[label=(\arabic*)]`, and
    // `[label=\Roman*.]` all expand the same way.
    //
    // Also handles bare inline sub-numbering — many worksheets don't wrap
    // sub-parts in `\begin{enumerate}` at all, they just prefix items with
    // `(1) …`, `(2) …`, `(3) …`. If we see two or more of those markers in
    // the parent item text (each starting a line after whitespace), split on
    // them the same way as an explicit nested enumerate.
    //
    // Parent's pre-nested text ("segment CD is a diameter…") becomes its OWN
    // section (labeled `סעיף {parent}`) so users see it as a stand-alone
    // context section, not merged into ג1.
    const nestedMatch =
      /\\begin\{enumerate\}\s*\[label=\(?\\(?:arabic|Roman|roman|Alph|alph)\*\)?[.:)]?[^\]]*\]([\s\S]*?)\\end\{enumerate\}/.exec(
        content,
      )
    // Detect bare `(N)` inline markers if there's no explicit nested enum.
    // Require ≥2 markers so isolated `(1)` inside a formula doesn't fire.
    const inlineMarkerRe = /(?:^|\n)\s*\((\d{1,2})\)\s+/g
    const inlineMarkers = nestedMatch ? [] : [...content.matchAll(inlineMarkerRe)]
    if (!nestedMatch && inlineMarkers.length >= 2) {
      const before = content.slice(0, inlineMarkers[0].index ?? 0).trim()
      // Slice item bodies between consecutive markers.
      const nestedItems: string[] = []
      for (let mi = 0; mi < inlineMarkers.length; mi++) {
        const m = inlineMarkers[mi]
        const startPos = (m.index ?? 0) + m[0].length
        const endPos =
          mi + 1 < inlineMarkers.length ? (inlineMarkers[mi + 1].index ?? content.length) : content.length
        nestedItems.push(content.slice(startPos, endPos).trim())
      }
      const beforeCleaned = before ? cleanItemText(before) : ''
      if (beforeCleaned) {
        blocks.push(
          makeFreeResponseBlock(
            `${sectionTitleMarker(`סעיף ${parentLetter}`)}${beforeCleaned}`,
          ),
        )
      }
      nestedItems.forEach((nItem, nIdx) => {
        const label = `סעיף ${parentLetter}${nIdx + 1}`
        const nCleaned = cleanItemText(nItem)
        if (nCleaned) {
          blocks.push(makeFreeResponseBlock(`${sectionTitleMarker(label)}${nCleaned}`))
        }
      })
      continue
    }
    if (nestedMatch) {
      const before = content.slice(0, nestedMatch.index).trim()
      const nestedInner = nestedMatch[1]
      const after = content.slice(nestedMatch.index + nestedMatch[0].length).trim()
      const nestedParts = nestedInner.split(/\\item(?![a-zA-Z])/).slice(1)
      const nestedItems = nestedParts.map((s) => s.trim()).filter(Boolean)
      if (nestedItems.length > 0) {
        // Parent's pre-nested context — emit as its own section (labeled
        // `סעיף {parent}`) with the context text as its prompt. Users see
        // it as a stand-alone context section, then the nested sub-parts
        // follow as `ד1, ד2, ד3` etc.
        const beforeCleaned = before ? cleanItemText(before) : ''
        if (beforeCleaned) {
          blocks.push(
            makeFreeResponseBlock(
              `${sectionTitleMarker(`סעיף ${parentLetter}`)}${beforeCleaned}`,
            ),
          )
        }
        nestedItems.forEach((nItem, nIdx) => {
          const label = `סעיף ${parentLetter}${nIdx + 1}`
          const nCleaned = cleanItemText(nItem)
          const afterCleaned =
            nIdx === nestedItems.length - 1 && after ? cleanItemText(after) : ''
          const combined = [nCleaned, afterCleaned].filter(Boolean).join('\n\n')
          if (combined) {
            blocks.push(makeFreeResponseBlock(`${sectionTitleMarker(label)}${combined}`))
          }
        })
        continue
      }
    }

    const cleaned = cleanItemText(content)
    if (!cleaned) continue
    blocks.push(
      makeFreeResponseBlock(`${sectionTitleMarker(`סעיף ${parentLetter}`)}${cleaned}`),
    )
  }

  return blocks
}

/**
 * Checks if an enumerate environment contains solution content
 * (used in \section*{פתרון} sections).
 */
export function parseEnumerateSolutions(innerContent: string): string[] {
  const solutions: string[] = []
  const parts = innerContent.split(/\\item\s*/)

  for (let i = 1; i < parts.length; i++) {
    const raw = parts[i].trim()
    if (!raw) continue
    solutions.push(cleanItemText(raw))
  }

  return solutions
}

/**
 * Checks if this is a solution section header.
 * Matches: \section*{פתרון תרגיל 1}, \subsection*{פתרון תרגיל 1},
 * \textbf{פתרון שאלה 1:}, \section*{פתרונות לתרגילים},
 * \subsection*{תשובה סופית - שאלה 1}
 */
export function isSolutionHeader(text: string): boolean {
  return (
    /\\(?:section|subsection)\*?\{פתרון/.test(text) ||
    /\\(?:section|subsection)\*?\{פתרונות/.test(text) ||
    /\\textbf\{פתרון\s+(?:תרגיל|שאלה)/.test(text) ||
    /\\(?:section|subsection)\*?\{תשובה\s+סופית/.test(text)
  )
}

/**
 * Strip `{\color{name} ...}` / `{\Large ...}` / `\textcolor{name}{...}` wrappers
 * from a candidate title so `\section*{{\color{explanation} תרגיל 1}}` can be
 * matched by the same regexes as `\section*{תרגיל 1}`.
 *
 * Iterated because color wrappers can appear nested inside sizing wrappers
 * and vice versa; each pass strips one layer.
 */
function stripTitleWrappers(text: string): string {
  let prev = ''
  let curr = text
  let guard = 0
  while (prev !== curr && guard++ < 6) {
    prev = curr
    curr = curr
      .replace(/\\textcolor\{[^}]*\}\s*/g, '')
      .replace(/\{\s*\\color\{[^}]*\}\s*/g, '{')
      .replace(/\{\s*\\(?:Large|large|huge|Huge|LARGE)\s*/g, '{')
      .replace(/\\color\{[^}]*\}\s*/g, '')
      .replace(/\\(?:Large|large|huge|Huge|LARGE)\s*/g, '')
      // Collapse nested `{{...}}` produced by wrapper removal into `{...}`.
      .replace(/\{\{([^{}]*)\}\}/g, '{$1}')
      .replace(/\{\s*\}/g, '')
  }
  return curr
}

/**
 * Detects if this is an exercise title.
 * Matches:
 *   \textbf{תרגיל 1 - Title} or \textbf{תרגיל 1}
 *   \textbf{שאלה 1 - Title} or \textbf{שאלה 1:} or \textbf{שאלה 1}
 *   \textbf{N. anything} — bare number followed by text (Hebrew worksheet pattern)
 *   \section*{תרגיל 1: Title} or \subsection*{תרגיל 1}
 *   \section*{שאלה 1} or \subsection*{שאלה 1}
 *   \section*{N. anything} — section titled with just a bare number
 *   \section*{{\color{name} תרגיל 1}} — color-wrapped titles (common in styled worksheets)
 *   \textbf{N.} standalone numbered exercise (e.g. \textbf{1.})
 */
export function isExerciseTitle(text: string): { title: string; number: number } | null {
  const stripped = stripTitleWrappers(text)

  // \textbf{תרגיל N ...}
  const textbfMatch = /\\textbf\{\s*(תרגיל\s+(\d+)[^}]*)\}/.exec(stripped)
  if (textbfMatch) return { title: textbfMatch[1].trim(), number: parseInt(textbfMatch[2], 10) }

  // \textbf{שאלה N ...} — common in Hebrew answer keys where each answer is
  // headed by "\textbf{שאלה N:}". Same shape as the תרגיל variant above.
  const textbfQMatch = /\\textbf\{\s*(שאלה\s+(\d+)[^}]*)\}/.exec(stripped)
  if (textbfQMatch) return { title: textbfQMatch[1].trim(), number: parseInt(textbfQMatch[2], 10) }

  // \section*{תרגיל N ...} or \subsection*{תרגיל N ...}
  const sectionExMatch = /\\(?:section|subsection)\*?\{\s*(תרגיל\s+(\d+)[^}]*)\}/.exec(stripped)
  if (sectionExMatch)
    return { title: sectionExMatch[1].trim(), number: parseInt(sectionExMatch[2], 10) }

  // \section*{שאלה N ...} or \subsection*{שאלה N ...}
  const sectionQMatch = /\\(?:section|subsection)\*?\{\s*(שאלה\s+(\d+)[^}]*)\}/.exec(stripped)
  if (sectionQMatch)
    return { title: sectionQMatch[1].trim(), number: parseInt(sectionQMatch[2], 10) }

  // \textbf{N.} — standalone numbered exercise boundary. Only 1-2 digit
  // numbers, so year-like values (\textbf{2024.}) don't get treated as
  // exercise anchors.
  const numberedMatch = /^\\textbf\{(\d{1,2})\.\s*\}$/.exec(stripped.trim())
  if (numberedMatch) {
    const num = parseInt(numberedMatch[1], 10)
    return { title: `תרגיל ${num}`, number: num }
  }

  // \textbf{N. text...} — bare number followed by inline exercise text.
  // Only accept reasonable exercise numbers (1-99) to avoid matching numeric
  // fragments like `\textbf{2024.}`. The rest of the textbf content becomes
  // the title so the reader can still see the intro.
  const numberedInlineMatch = /^\\textbf\{\s*(\d{1,2})\.\s+([^}]{1,200})\}/.exec(stripped.trim())
  if (numberedInlineMatch) {
    const num = parseInt(numberedInlineMatch[1], 10)
    return { title: `תרגיל ${num}`, number: num }
  }

  // \section*{N. text...} — section using a bare number as the exercise anchor
  const sectionNumberedMatch = /\\(?:section|subsection)\*?\{\s*(\d{1,2})\.\s*([^}]{0,200})\}/.exec(
    stripped,
  )
  if (sectionNumberedMatch) {
    const num = parseInt(sectionNumberedMatch[1], 10)
    return { title: `תרגיל ${num}`, number: num }
  }

  return null
}

/** Check if text contains an enumerate-style exercise pattern */
export function isEnumerateExercise(envContent: string): boolean {
  return /\\item/.test(envContent) && /label\s*=/.test(envContent)
}

/**
 * Convert rich_text blocks into context paragraphs.
 * Used to prepend narrative text before sub-questions.
 */
export function makeContextBlock(text: string): ContentBlock {
  const cleaned = cleanItemText(text)
  return makeRichTextBlock(cleaned)
}
