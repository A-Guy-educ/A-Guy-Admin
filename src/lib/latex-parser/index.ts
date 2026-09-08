import type {
  ParseResult,
  ParseWarning,
  MultiExerciseResult,
  ExerciseGroup,
} from '@/lib/latex-parser/types'
import type { LatexToken } from '@/lib/latex-parser/types'
import { sanitizeLatex } from '@/lib/latex-parser/sanitizer'
import { tokenize } from '@/lib/latex-parser/tokenizer'
import { parseExamClsMcq } from '@/lib/latex-parser/mcq-exam-cls'
import { parseEnumitemMcq } from '@/lib/latex-parser/mcq-enumitem'
import { parseInlineMcq } from '@/lib/latex-parser/mcq-inline'
import {
  parseEnumerate,
  isSolutionHeader,
  isExerciseTitle,
} from '@/lib/latex-parser/enumerate-parser'
import { parseTabular } from '@/lib/latex-parser/tabular-parser'
import {
  parseTikzAxis,
  hasTikzAxis,
  parseTikzDrawPlot,
  hasTikzDrawPlot,
  parseTikzAxisGeometry,
  hasTikzAxisGeometry,
} from '@/lib/latex-parser/tikz-axis-parser'
import { parseTikzGeometry, hasTikzGeometry } from '@/lib/latex-parser/tikz-geometry-parser'
import { makeRichTextBlock } from '@/lib/latex-parser/block-generators'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

/**
 * Splits the inner text of a `questions` environment on `\question` boundaries,
 * then tries parseExamClsMcq on each chunk (question + following choices env).
 */
function processQuestionsEnv(
  innerText: string,
  blocks: ContentBlock[],
  warnings: ParseWarning[],
  line: number,
): void {
  // Split on \question so each piece starts with the question text + choices block
  const parts = innerText.split(/(?=\\question\s)/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const mcq = parseExamClsMcq(trimmed)
    if (mcq) {
      blocks.push(mcq)
    } else if (trimmed.startsWith('\\question')) {
      // Has a question marker but failed to parse — emit as rich_text with warning
      blocks.push(makeRichTextBlock(trimmed))
      warnings.push({ line, message: 'Could not parse question block', rawLatex: trimmed })
    }
    // Non-question preamble text inside questions env is silently skipped
  }
}

/**
 * Tries all MCQ matchers on a text chunk.
 * Returns a parsed block or null.
 */
function tryMcqMatchers(text: string): ContentBlock | null {
  return parseExamClsMcq(text) ?? parseEnumitemMcq(text) ?? parseInlineMcq(text)
}

/** Preamble-only command names that should be silently skipped */
const PREAMBLE_COMMANDS = new Set([
  'documentclass',
  'usepackage',
  'pagestyle',
  'setlength',
  'geometry',
  'fancyhf',
  'renewcommand',
  'newcommand',
  'title',
  'author',
  'date',
  'maketitle',
  'linespread',
  'newfontfamily',
  'setmainlanguage',
  'setotherlanguage',
  'usetikzlibrary',
  'pgfplotsset',
  'onehalfspacing',
])

/** Environments that just wrap content — recurse into children */
const PASSTHROUGH_ENVS = new Set([
  'document',
  'minipage',
  'center',
  'flushleft',
  'flushright',
  'spacing',
  'RTL',
  'LTR',
  'otherlanguage',
  'hebrew',
  'english',
])

/** Layout/formatting commands to silently skip */
const SKIP_COMMANDS = new Set([
  ...PREAMBLE_COMMANDS,
  'noindent',
  'vspace',
  'hspace',
  'hfill',
  'vfill',
  'newpage',
  'clearpage',
  'bigskip',
  'medskip',
  'pagenumbering',
  'smallskip',
  'selectlanguage',
  'begingroup',
  'endgroup',
  'LARGE',
  'large',
  'renewcommand',
  'arraystretch',
  'definecolor',
  'color',
  'centering',
  'cfoot',
  'lfoot',
  'fancyhf',
  'headrulewidth',
  'thepage',
  'footnotesize',
  'itemsep',
])

/**
 * Find the matching closing brace for an opening brace, handling nesting.
 * Returns the index of the matching }, or -1 if not found.
 */
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
 * Strip {\color{name} content} and {\Large\color{name} content} groups,
 * using proper brace counting to handle nested braces like \frac{1}{...}.
 * Also strips \textcolor{name}{content}, keeping only the content.
 */
function stripColorAndSizing(text: string): string {
  // Strip \textcolor{name}{content} → content (brace-counted so nested {} works)
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '\\' && text.slice(i, i + 10) === '\\textcolor') {
      const headerMatch = /^\\textcolor\{[^}]+\}\{/.exec(text.slice(i))
      if (headerMatch) {
        const openContentBrace = i + headerMatch[0].length - 1
        const closingBrace = findMatchingBrace(text, openContentBrace)
        if (closingBrace > openContentBrace) {
          result += text.slice(openContentBrace + 1, closingBrace)
          i = closingBrace + 1
          continue
        }
      }
    }
    result += text[i]
    i++
  }

  // Process {\color{name} ...} and {\Large\color{name} ...} groups with brace counting
  // We scan for { followed by \color or \Large\color, find the matching }, and remove the wrapper
  i = 0
  let output = ''
  while (i < result.length) {
    if (result[i] === '{') {
      // Check if this opens a color/sizing group
      const after = result.slice(i + 1)

      const cmdMatch =
        /^\\(?:Large|large|huge|Huge)\s*\\color\{[^}]*\}\s*/.exec(after) ||
        /^\\color\{[^}]*\}\s*/.exec(after) ||
        /^\\(?:Large|large|huge|Huge)\s*/.exec(after)

      if (cmdMatch) {
        const closingBrace = findMatchingBrace(result, i)
        if (closingBrace > i) {
          // Extract the content between the command and the closing brace
          const contentStart = i + 1 + cmdMatch[0].length
          output += result.slice(contentStart, closingBrace)
          i = closingBrace + 1
          continue
        }
      }
    }
    output += result[i]
    i++
  }
  result = output

  // Strip bare commands (not wrapped in braces)
  result = result
    .replace(/\\(?:Large|large|huge|Huge|normalsize|small|footnotesize|tiny)\s*/g, '')
    .replace(/\\color\{[^}]*\}/g, '')
    .replace(/\\definecolor\{[^}]*\}\{[^}]*\}\{[^}]*\}/g, '')

  return result
}

/** Clean LaTeX text: strip formatting commands, normalize whitespace */
function cleanText(text: string): string {
  return (
    stripColorAndSizing(text)
      // Strip leaked environment tags
      .replace(
        /\\(?:begin|end)\{(?:enumerate|center|itemize|tikzpicture|tabular\*?|tcolorbox)\}(?:\[[^\]]*\])?/g,
        '',
      )
      .replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, '')
      .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
      .replace(/\\textit\{([^}]*)\}/g, '*$1*')
      .replace(/\\emph\{([^}]*)\}/g, '*$1*')
      .replace(/\\(?:underline|underbar)\{([^}]*)\}/g, '$1')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\\\/g, ' ')
      .replace(/\\vspace\{[^}]*\}/g, ' ')
      .replace(/\\hspace\*?\{[^}]*\}/g, ' ')
      .replace(/\\noindent/g, '')
      .replace(/\\selectlanguage\{[^}]*\}/g, '')
      .replace(/\\begingroup/g, '')
      .replace(/\\endgroup/g, '')
      .replace(/\\arraystretch/g, '')
      // Strip leading line-break spacing like [0.2cm], [5mm]
      .replace(/^\s*\[\d+(\.\d+)?(cm|mm|pt|em|ex)\]\s*/g, '')
      // Collapse all whitespace into single spaces — prevents the frontend
      // from splitting text into "context outside box" vs "content inside box"
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Rewrite section/subsection/textbf titles so their arguments contain no
 * nested braces. The flat tokenizer stops command args at the first `}`, so
 * `\section*{{\color{name} תרגיל 1}}` is otherwise truncated to
 * `\section*{{\color{name}` and the exercise title is lost.
 *
 * We locate each occurrence, brace-count to the true closing `}`, then strip
 * `{\color{...}` / `{\Large}` / `\textcolor{...}{...}` wrappers from inside
 * the argument. The rewritten command has a flat, brace-free argument that
 * matches the tokenizer's assumptions and `isExerciseTitle`'s patterns.
 */
function unwrapStyledTitleArgs(src: string): string {
  const cmdRe = /\\(section|subsection|textbf)\*?\{/g
  let out = ''
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = cmdRe.exec(src)) !== null) {
    const openBraceIdx = match.index + match[0].length - 1
    const closeIdx = findMatchingBrace(src, openBraceIdx)
    if (closeIdx === -1) continue
    const arg = src.slice(openBraceIdx + 1, closeIdx)
    if (!arg.includes('{')) continue
    const flat = flattenTitleArg(arg)
    if (flat === arg) continue
    out += src.slice(cursor, openBraceIdx + 1) + flat
    cursor = closeIdx
    cmdRe.lastIndex = closeIdx
  }
  return out + src.slice(cursor)
}

/**
 * Strip color/sizing wrappers from a title argument, collapsing nested groups
 * so the result contains no `{` or `}`. `\textcolor{name}{content}` keeps
 * `content`; `{\color{name} X}` and `{\Large X}` keep `X`.
 */
function flattenTitleArg(arg: string): string {
  let result = arg
  for (let i = 0; i < 5; i++) {
    const next = result
      .replace(/\\textcolor\{[^}]*\}\{([^{}]*)\}/g, '$1')
      .replace(/\{\s*\\color\{[^}]*\}\s*([^{}]*)\}/g, '$1')
      .replace(/\{\s*\\(?:Large|large|huge|Huge|LARGE|normalsize)\s*([^{}]*)\}/g, '$1')
      .replace(/\\(?:Large|large|huge|Huge|LARGE|normalsize)\s*/g, '')
      .replace(/\\color\{[^}]*\}\s*/g, '')
    if (next === result) break
    result = next
  }
  return result
}

/**
 * Detects an itemize/enumerate whose items carry explicit `\item[label]`
 * markers such as `\item[\textbf{א.}]` or `\item[א.]`. These lists are
 * effectively sub-question lists and should be handled by parseEnumerate,
 * not collapsed into bullet-point text.
 */
function hasExplicitSubQuestionLabels(inner: string): boolean {
  // Match \item[\textbf{א.}], \item[א.], \item[(1)], \item[a.], etc.
  const labelChar = '[\\u0590-\\u05FFa-z0-9]'
  const label = `\\(?${labelChar}${labelChar}?[.)]?\\)?`
  const re = new RegExp(`\\\\item\\s*\\[\\s*(?:\\\\textbf\\{)?\\s*${label}\\s*\\}?\\s*\\]`, 'i')
  return re.test(inner)
}

/**
 * Detects LaTeX noise fragments that shouldn't become blocks.
 * These are typically orphaned arguments/options from parsed commands.
 */
function isLatexNoise(text: string): boolean {
  const stripped = text.replace(/\s/g, '')
  // Orphaned option brackets: [0.2cm], [t], [h], [H], [!ht]
  if (/^\[[^\]]*\]$/.test(stripped)) return true
  // Orphaned braces with a number or simple value: {1.5}, {0.55\textwidth}
  if (/^\{[^}]*\}$/.test(stripped)) return true
  // Minipage option fragments: [t]{0.55\textwidth} or [t]{0.45
  if (/^\[[^\]]*\]\{[^}]*\}?$/.test(stripped)) return true
  // Column spec fragments: |c|c|c|
  if (/^\|?[clrp|]+\|?$/.test(stripped)) return true
  // Purely numeric or single special char
  if (/^[\d.]+$/.test(stripped)) return true
  return false
}

/**
 * Processes a list of tokens into ContentBlocks.
 * Handles Bagrut exam format, exam.cls MCQ, and general LaTeX.
 */
function processTokens(
  tokens: LatexToken[],
  blocks: ContentBlock[],
  warnings: ParseWarning[],
): void {
  let inSolutionSection = false

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type === 'environment') {
      const envName = token.name ?? ''

      if (PASSTHROUGH_ENVS.has(envName)) {
        if (token.children?.length) {
          processTokens(token.children, blocks, warnings)
        }
      } else if (envName === 'titlepage') {
        // Author's transcription tool emits a `\begin{titlepage}` cover with
        // course metadata (מקצוע, רמת לימוד, כיתה/שאלון, מועד, תאריך, פרק,
        // נושאים, הערות כלליות). None of that is exercise content — skip.
      } else if (envName === 'questions') {
        const inner = extractInner(token)
        processQuestionsEnv(inner, blocks, warnings, token.line)
      } else if (envName === 'itemize') {
        const inner = extractInner(token)
        // Hebrew worksheets commonly use itemize with explicit labels
        // (`\item[\textbf{א.}]`) as a sub-question list — treat those as
        // enumerate so each item becomes a question_free_response block.
        if (hasExplicitSubQuestionLabels(inner)) {
          const enumBlocks = parseEnumerate(inner)
          if (inSolutionSection && enumBlocks.length > 0) {
            attachSolutions(blocks, enumBlocks)
          } else {
            blocks.push(...enumBlocks)
          }
        } else {
          // Plain bullet list — collapse into bullet-point rich text.
          // Split on \item, then SKIP index 0 (pre-item content: the env's
          // `[options]` block and surrounding whitespace). Otherwise
          // `\begin{itemize}[rightmargin=1em]` produces a bullet whose text
          // is `[rightmargin=1em]`.
          const parts = inner.split(/\\item\s*/)
          const bullets = parts
            .slice(1)
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
            .map((item) => `• ${cleanText(item)}`)
            .join('\n')
          if (bullets) {
            blocks.push(makeRichTextBlock(bullets))
          }
        }
      } else if (envName === 'enumerate') {
        const inner = extractInner(token)
        // Extract any tikzpictures nested inside enumerate items — parseEnumerate
        // strips them from the item text (it has no way to nest a diagram
        // inside a `question_free_response` prompt). Emit each as its own
        // block, then let parseEnumerate produce the sub-question stream from
        // the tikz-stripped remainder.
        const tikzBlocks: ContentBlock[] = []
        const tikzRe = /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g
        let tMatch: RegExpExecArray | null
        while ((tMatch = tikzRe.exec(inner)) !== null) {
          const raw = tMatch[0]
          if (hasTikzAxis(raw)) {
            const b = parseTikzAxis(raw)
            if (b) tikzBlocks.push(b)
          } else if (hasTikzDrawPlot(raw)) {
            const b = parseTikzDrawPlot(raw)
            if (b) tikzBlocks.push(b)
          } else if (hasTikzAxisGeometry(raw)) {
            const b = parseTikzAxisGeometry(raw)
            if (b) tikzBlocks.push(b)
          } else if (hasTikzGeometry(raw)) {
            const b = parseTikzGeometry(raw)
            if (b) tikzBlocks.push(b)
          }
        }
        const enumBlocks = parseEnumerate(inner)
        if (inSolutionSection && enumBlocks.length > 0) {
          // Solution enumerate — attach as fullSolution to previous question blocks
          attachSolutions(blocks, enumBlocks)
        } else {
          blocks.push(...enumBlocks)
          blocks.push(...tikzBlocks)
        }
      } else if (envName === 'tabular' || envName === 'tabular*') {
        const inner = extractInner(token)
        // If the tabular contains tikzpictures (e.g. Q6 option graphs), extract those
        if (/\\begin\{tikzpicture\}/.test(inner)) {
          const tikzBlocks = extractTikzFromTabular(inner, blocks, warnings, token.line)
          blocks.push(...tikzBlocks)
        } else {
          const table = parseTabular(inner)
          if (table) {
            blocks.push(table)
          }
        }
      } else if (envName === 'tikzpicture') {
        const raw = token.value ?? ''
        if (hasTikzAxis(raw)) {
          const axisBlock = parseTikzAxis(raw)
          if (axisBlock) {
            blocks.push(axisBlock)
          }
        } else if (hasTikzDrawPlot(raw)) {
          // Raw \draw ... plot (\x, {expr}) — function graphs without \begin{axis}
          const drawPlotBlock = parseTikzDrawPlot(raw)
          if (drawPlotBlock) {
            blocks.push(drawPlotBlock)
          }
        } else if (hasTikzAxisGeometry(raw)) {
          // Geometric shapes drawn in a manual axis coordinate system —
          // `\draw[->]` axes + `\draw (X,Y) -- (X,Y) -- cycle` shapes.
          // Emit as an axis block so the coordinate system is preserved.
          const axisGeoBlock = parseTikzAxisGeometry(raw)
          if (axisGeoBlock) {
            blocks.push(axisGeoBlock)
          }
        } else if (hasTikzGeometry(raw)) {
          const geoBlock = parseTikzGeometry(raw)
          if (geoBlock) {
            blocks.push(geoBlock)
          }
        }
        // Unrecognized tikzpicture → silently skip (can't render TikZ client-side)
      } else if (envName === 'choices') {
        // Standalone choices env (already handled by questions env processor)
        const inner = extractInner(token)
        const mcq = tryMcqMatchers(inner)
        if (mcq) blocks.push(mcq)
      } else if (envName === 'list') {
        // Custom `\begin{list}{<label>}{<params>}...\end{list}` is often used
        // in Hebrew PDF worksheets to wrap the exercise number + intro
        // paragraph, e.g. `\begin{list}{\textbf{1.}}{...}\item <intro>\end{list}`.
        // Emit a `## תרגיל N` heading so parseLatexToExercises can split on it,
        // then process the item content as rich_text. The second `{<params>}`
        // brace group (setlength calls, etc.) is skipped by finding the first
        // \item and taking everything after it.
        const raw = token.value ?? ''
        const labelMatch = /\\begin\{list\}\s*\{\\textbf\{\s*(\d+)\.\s*\}\}/.exec(raw)
        if (labelMatch) {
          const num = parseInt(labelMatch[1], 10)
          blocks.push(makeRichTextBlock(`## תרגיל ${num}`))
        }
        const inner = extractInner(token)
        // Use a word-boundary regex so we match `\item` the command, not
        // `\itemindent` / `\itemsep` (both appear in the list's second brace
        // group of setlength calls). A plain indexOf('\\item') matched the
        // former and stole the list params into the item content.
        const itemMatch = /\\item(?![a-zA-Z])/.exec(inner)
        if (itemMatch) {
          const itemContent = inner.slice(itemMatch.index).replace(/^\\item\s*/, '')
          const contentTokens = tokenize(itemContent, token.line)
          processTokens(contentTokens, blocks, warnings)
        } else if (!labelMatch) {
          // No numbered label AND no items — treat as unknown env fallback
          const cleaned = cleanText(inner)
          if (cleaned) {
            blocks.push(makeRichTextBlock(cleaned))
            warnings.push({
              line: token.line,
              message: 'Unrecognized list environment (no numbered label, no items)',
              rawLatex: raw,
            })
          }
        }
      } else {
        // Unknown environment — try MCQ matchers, then fall back to rich_text with warning
        const inner = extractInner(token)
        const mcq = tryMcqMatchers(inner)
        if (mcq) {
          blocks.push(mcq)
        } else {
          const cleaned = cleanText(inner || token.value)
          if (cleaned) {
            blocks.push(makeRichTextBlock(cleaned))
            warnings.push({
              line: token.line,
              message: `Unrecognized environment: ${envName}`,
              rawLatex: token.value,
            })
          }
        }
      }
    } else if (token.type === 'math') {
      // Strip color/sizing commands from math expressions
      const val = stripColorAndSizing(token.value)
      // Emit all math as rich_text with md-math-v1 format
      // The frontend renderer handles $...$ (inline) and $$...$$ (display) in rich_text
      // but does NOT render standalone 'latex' block types
      blocks.push(makeRichTextBlock(val))
    } else if (token.type === 'command') {
      const cmdName = token.name ?? ''
      if (SKIP_COMMANDS.has(cmdName)) {
        // Silently skip
      } else if (cmdName === 'section' || cmdName === 'subsection') {
        const titleMatch = /\\(?:section|subsection)\*?\{([^}]*)\}/.exec(token.value)
        const title = titleMatch ? titleMatch[1] : token.value
        if (isSolutionHeader(token.value)) {
          inSolutionSection = true
          // Don't emit solution headers as blocks — solutions are attached to questions
        } else {
          inSolutionSection = false
          // Check if this is an exercise title (תרגיל N or שאלה N)
          const exerciseInfo = isExerciseTitle(token.value)
          if (exerciseInfo) {
            blocks.push(makeRichTextBlock(`## ${exerciseInfo.title}`))
          } else {
            blocks.push(makeRichTextBlock(`## ${title}`))
          }
        }
      } else if (cmdName === 'textbf') {
        // Check if this is an exercise title like \textbf{תרגיל 1 - Title}
        const exerciseInfo = isExerciseTitle(token.value)
        if (exerciseInfo) {
          inSolutionSection = false
          blocks.push(makeRichTextBlock(`## ${exerciseInfo.title}`))
        } else {
          const cleaned = cleanText(token.value)
          if (cleaned) blocks.push(makeRichTextBlock(cleaned))
        }
      } else if (cmdName === 'question') {
        // Standalone \question (exam.cls) — collect text/math tokens then choices env
        const lookahead: string[] = [token.value]
        let j = i + 1
        while (j < tokens.length) {
          const next = tokens[j]
          if (next.type === 'text' || next.type === 'math') {
            lookahead.push(next.value)
            j++
          } else if (next.type === 'environment' && next.name === 'choices') {
            lookahead.push(next.value)
            j++
            break
          } else {
            break
          }
        }
        const combined = lookahead.join('\n')
        const mcq = parseExamClsMcq(combined)
        if (mcq) {
          blocks.push(mcq)
          i = j - 1
        } else {
          blocks.push(makeRichTextBlock(token.value))
        }
      }
      // Other commands silently ignored
    } else if (token.type === 'text') {
      const text = cleanText(token.value)
      if (text && text.length > 1 && !isLatexNoise(text)) {
        blocks.push(makeRichTextBlock(text))
      }
    }
  }
}

/**
 * Attaches solution content from solution enumerate blocks to
 * the most recent question_free_response blocks.
 */
function attachSolutions(blocks: ContentBlock[], solutionBlocks: ContentBlock[]): void {
  // Find the last N free_response blocks matching solution count
  const questionBlocks = blocks.filter((b) => b.type === 'question_free_response')
  const startIdx = Math.max(0, questionBlocks.length - solutionBlocks.length)

  for (let i = 0; i < solutionBlocks.length; i++) {
    const target = questionBlocks[startIdx + i]
    const solBlock = solutionBlocks[i]
    if (
      target &&
      target.type === 'question_free_response' &&
      solBlock.type === 'question_free_response'
    ) {
      target.fullSolution = {
        type: 'rich_text',
        format: 'md-math-v1',
        value: solBlock.prompt.value,
        mediaIds: [],
      }
    }
  }
}

/**
 * Extracts tikzpicture blocks embedded inside a tabular (e.g. option graph grids).
 * Finds each \begin{tikzpicture}...\end{tikzpicture} and parses it as a diagram.
 */
function extractTikzFromTabular(
  inner: string,
  _blocks: ContentBlock[],
  warnings: ParseWarning[],
  line: number,
): ContentBlock[] {
  const result: ContentBlock[] = []
  const tikzRe = /\\begin\{tikzpicture\}([\s\S]*?)\\end\{tikzpicture\}/g
  let match: RegExpExecArray | null
  while ((match = tikzRe.exec(inner)) !== null) {
    const raw = match[0]
    if (hasTikzAxis(raw)) {
      const axisBlock = parseTikzAxis(raw)
      if (axisBlock) result.push(axisBlock)
    } else if (hasTikzDrawPlot(raw)) {
      const drawPlotBlock = parseTikzDrawPlot(raw)
      if (drawPlotBlock) result.push(drawPlotBlock)
    } else if (hasTikzGeometry(raw)) {
      const geoBlock = parseTikzGeometry(raw)
      if (geoBlock) result.push(geoBlock)
    } else {
      warnings.push({ line, message: 'Unrecognized tikzpicture in tabular', rawLatex: raw })
    }
  }
  return result
}

/** Extract inner content from an environment token (strip begin/end tags) */
function extractInner(token: import('@/lib/latex-parser/types').LatexToken): string {
  const envName = token.name ?? ''
  const raw = token.value ?? ''
  const beginTag = `\\begin{${envName}}`
  const endTag = `\\end{${envName}}`
  const innerStart = raw.indexOf(beginTag)
  const innerEnd = raw.lastIndexOf(endTag)
  return innerStart !== -1 && innerEnd > innerStart
    ? raw.slice(innerStart + beginTag.length, innerEnd)
    : raw
}

/**
 * Parses a LaTeX string into a list of ContentBlocks.
 *
 * Steps:
 *  1. Return empty on blank input.
 *  2. Sanitize – reject if dangerous commands found.
 *  3. Tokenize into a flat token stream.
 *  4. Map tokens to blocks.
 */
export function parseLatexToBlocks(latex: string): ParseResult {
  const blocks: ContentBlock[] = []
  const warnings: ParseWarning[] = []

  if (!latex.trim()) {
    return { blocks, warnings, errors: [] }
  }

  // Strip preamble before \begin{document} — preamble commands are safe
  let source = latex
  const beginDocIdx = source.indexOf('\\begin{document}')
  if (beginDocIdx !== -1) {
    source = source.slice(beginDocIdx)
  }

  source = unwrapStyledTitleArgs(source)

  // Strip a handful of layout / custom-macro noise before tokenizing:
  //  - `\hrule[ height 1.2pt][ width ...]` — TeX primitive with option-y args
  //    that aren't in {...} braces, so the tokenizer would emit them as
  //    trailing text (`height 1.2pt}`) and pollute rich_text blocks.
  //  - `\mcolor{X}` — custom color macro from the author's newcommands. Unlike
  //    `\color`/`\textcolor`, this is document-specific and unknown to KaTeX,
  //    so `$\mcolor{x}$` renders as literal `\mcolor{x}` in inline math. Peel
  //    the wrapper and keep the inner content.
  source = source
    .replace(
      /\\hrule\s*(?:height\s+[\d.]+(?:cm|mm|pt|em|ex)\s*)?(?:width\s+[\d.]+(?:cm|mm|pt|em|ex)\s*)?/g,
      '',
    )
    .replace(/\\mcolor\s*\{([^}]*)\}/g, '$1')
    // `\setlength{\name}{value}` — two-arg TeX primitive. The tokenizer's
    // COMMAND_RE only captures one `{arg}` per command, so the second `{value}`
    // leaks into text tokens as `{0.5em}` / `{0pt}` fragments. Pre-strip the
    // whole two-arg form so nothing leaks. Same treatment for `\setcounter`.
    .replace(/\\setlength\s*\{[^}]*\}\s*\{[^}]*\}/g, '')
    // `\begin{minipage}[t]{0.6\textwidth}` — the `[t]` positional option and
    // the `{0.6\textwidth}` width arg leak into the env's inner content as
    // stray `{0.6\textwidth}` text tokens. Strip the args so the tokenizer
    // sees a clean `\begin{minipage}`. Also handle `\begin{tabular}{|c|c|}`
    // (column spec) — kept alive because the tabular parser reads it back
    // from `token.value` directly.
    .replace(/\\begin\{minipage\}\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '\\begin{minipage}')
    // `\\[0.1cm]` — LaTeX line break with optional vertical spacing. The
    // tokenizer consumes the `\\` as a text substitution, but the following
    // `[0.1cm]` is left as literal text and shows up as an `[0.1cm]` blot in
    // rich_text blocks.
    .replace(/\\\\\s*\[\d+(?:\.\d+)?(?:cm|mm|pt|em|ex)\]/g, ' ')
    // `\[...\]` display math — convert to `$$...$$` since the frontend only
    // recognizes `$$` as display math. Inner content (including nested
    // `\begin{aligned}...\end{aligned}` for `&`-aligned equations) stays
    // intact — KaTeX renders those inside `$$...$$`. Flatten inner newlines
    // to a single space so the markdown+math renderer picks up the `$$`
    // delimiters as a single-line display math (multiline `$$` breaks in
    // the markdown parser).
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$${body.trim().replace(/\s+/g, ' ')}$$`)

  const sanitized = sanitizeLatex(source)
  if (!sanitized.safe) {
    const violations = sanitized.violations.map((v) => v.command).join(', ')
    return {
      blocks: [],
      warnings: [],
      errors: [
        {
          line: sanitized.violations[0]?.line ?? 1,
          message: `Dangerous LaTeX commands detected: ${violations}`,
          rawLatex: source,
        },
      ],
    }
  }

  const tokens = tokenize(source)
  processTokens(tokens, blocks, warnings)

  // Merge consecutive rich_text blocks (inline math splits text into fragments)
  const merged = mergeAdjacentRichText(blocks)

  // Move any intro rich_text into the graphics block's prompt slot — an
  // exercise that has a diagram treats the diagram as its primary block,
  // with the intro paragraph rendered inside the block's text area rather
  // than as a separate rich_text sibling above it.
  const compacted = absorbIntroIntoGraphicsPrompt(merged)

  return { blocks: compacted, warnings, errors: [] }
}

/**
 * Types whose `prompt: InlineRichText` slot renders as the block's own
 * intro/text area. When an exercise has one of these, we hoist the
 * exercise's intro rich_text into that prompt so the exercise displays as
 * "diagram + text" rather than "text block, then diagram block".
 */
const GRAPHICS_BLOCK_TYPES = new Set(['question_axis', 'question_geometry', 'question_multi_axis'])

/**
 * Walk the block list per-exercise (split on `## תרגיל N` / `## שאלה N`
 * headings). In each segment, if there's a graphics block, take every
 * standalone `rich_text` in that segment (except the heading) and merge
 * their text into the graphics block's `prompt.value`, then drop them.
 * Sub-question blocks (question_free_response, question_select, ...) are
 * left untouched.
 */
function absorbIntroIntoGraphicsPrompt(blocks: ContentBlock[]): ContentBlock[] {
  const isHeading = (b: ContentBlock): boolean =>
    b.type === 'rich_text' && /^##\s+(?:תרגיל|שאלה)\s+\d/.test(b.value)

  // Split into segments delimited by heading rich_texts.
  const segments: ContentBlock[][] = []
  let current: ContentBlock[] = []
  for (const b of blocks) {
    if (isHeading(b)) {
      if (current.length > 0) segments.push(current)
      current = [b]
    } else {
      current.push(b)
    }
  }
  if (current.length > 0) segments.push(current)

  const out: ContentBlock[] = []
  for (const seg of segments) {
    const graphicsIdx = seg.findIndex((b) => GRAPHICS_BLOCK_TYPES.has(b.type))
    if (graphicsIdx === -1) {
      out.push(...seg)
      continue
    }
    // Rich texts to absorb: standalone rich_text in this segment, excluding
    // the leading heading. Keep the heading (Stage 2 uses it as the exercise
    // title boundary) and preserve non-rich_text blocks (sub-questions).
    const introParts: string[] = []
    const keep: ContentBlock[] = []
    for (const b of seg) {
      if (b.type === 'rich_text' && !isHeading(b)) {
        const v = b.value.trim()
        if (v) introParts.push(v)
      } else {
        keep.push(b)
      }
    }
    const introText = introParts.join('\n\n')
    // Merge intro into the graphics block's prompt (first graphics block in segment).
    const graphics = keep.find((b) => GRAPHICS_BLOCK_TYPES.has(b.type)) as ContentBlock & {
      prompt?: { type: 'rich_text'; format: 'md-math-v1'; value: string; mediaIds: string[] }
    }
    if (graphics && introText) {
      const existing = graphics.prompt?.value?.trim() ?? ''
      const merged = existing ? `${introText}\n\n${existing}` : introText
      graphics.prompt = {
        type: 'rich_text',
        format: 'md-math-v1',
        value: merged,
        mediaIds: [],
      }
    }

    // Hoist the graphics block to the front of the segment (right after the
    // heading, BEFORE any question block). partitionBlocks() sends the
    // pre-first-question region to `exerciseSharedBlocks`, so the diagram
    // ends up at exercise level instead of tucked inside a section.
    if (graphics) {
      const heading = keep[0] && isHeading(keep[0]) ? keep[0] : null
      const others = keep.filter((b) => b !== graphics && b !== heading)
      const ordered: ContentBlock[] = []
      if (heading) ordered.push(heading)
      ordered.push(graphics)
      ordered.push(...others)
      out.push(...ordered)
    } else {
      out.push(...keep)
    }
  }
  return out
}

/**
 * Merges consecutive rich_text blocks into single blocks.
 * This fixes fragmentation caused by the tokenizer splitting text around inline math.
 */
function mergeAdjacentRichText(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = []

  for (const block of blocks) {
    const prev = result[result.length - 1]
    if (
      block.type === 'rich_text' &&
      prev?.type === 'rich_text' &&
      !prev.value.startsWith('## ') &&
      !block.value.startsWith('## ')
    ) {
      // Merge into previous rich_text block
      prev.value = `${prev.value} ${block.value}`
    } else {
      result.push(block)
    }
  }

  return result
}

/**
 * Exercise title pattern: `## תרגיל N` or `## שאלה N` or `## תרגיל N - Title`
 * These are emitted by processTokens when isExerciseTitle() matches.
 */
const EXERCISE_HEADING_RE = /^## (?:תרגיל|שאלה)\s+(\d+)/

/**
 * Parses LaTeX into multiple exercises split on `\textbf{תרגיל N}` boundaries.
 *
 * If the LaTeX contains no exercise titles, returns a single exercise
 * with all blocks (backward-compatible with single-exercise import).
 */
export function parseLatexToExercises(latex: string): MultiExerciseResult {
  const parsed = parseLatexToBlocks(latex)
  if (parsed.errors.length > 0) {
    return { exercises: [], warnings: parsed.warnings, errors: parsed.errors }
  }

  const exercises: ExerciseGroup[] = []
  let current: ExerciseGroup | null = null

  for (const block of parsed.blocks) {
    if (block.type === 'rich_text') {
      const match = EXERCISE_HEADING_RE.exec(block.value)
      if (match) {
        current = {
          title: block.value.replace(/^## /, ''),
          number: parseInt(match[1], 10),
          blocks: [],
        }
        exercises.push(current)
        continue
      }
    }
    if (current) {
      current.blocks.push(block)
    } else {
      // Blocks before any exercise title — create an unnamed group
      if (exercises.length === 0 || exercises[0].number !== 0) {
        current = { title: '', number: 0, blocks: [] }
        exercises.unshift(current)
      }
      exercises[0].blocks.push(block)
    }
  }

  // If no exercise boundaries found, wrap all blocks in a single exercise
  if (exercises.length === 0) {
    return {
      exercises: [{ title: '', number: 1, blocks: parsed.blocks }],
      warnings: parsed.warnings,
      errors: [],
    }
  }

  // Filter out empty exercises (title-only with no content)
  const nonEmpty = exercises.filter((e) => e.blocks.length > 0)

  return { exercises: nonEmpty, warnings: parsed.warnings, errors: [] }
}
