/**
 * Context Exercise Parser
 *
 * Parses ContextExtractions LaTeX text into structured exercise segments.
 * Shared between the admin ContextExerciseViewer (client) and the
 * server-side exercise creation service.
 */

export interface ParsedExercise {
  number: number
  title: string
  /** The LaTeX header that matched (e.g. "\\textbf{תרגיל 1}") */
  header: string
  latexContent: string
  solution: string | null
  /** The solution header if present (e.g. "\\section*{פתרון תרגיל 1}") */
  solutionHeader: string | null
  hasDiagram: boolean
  /** Character offsets within the extraction run text for reconstruction */
  startIndex: number
  endIndex: number
}

export interface ParsedSegment {
  exercises: ParsedExercise[]
  extractionIndex: number
  /** Original text of this extraction run */
  originalText: string
}

/** Check if text contains TikZ or minipage diagram markers */
export function hasDiagramCheck(text: string): boolean {
  return /\\(begin|end)\{(?:tikzpicture|minipage)\}/.test(text)
}

/**
 * Parse LaTeX text into structured exercise segments.
 * Handles multiple extraction runs separated by \n\n---\n\n
 * Tracks character positions for write-back support.
 */
export function parseContextText(contextText: string): ParsedSegment[] {
  if (!contextText || !contextText.trim()) {
    return []
  }

  // Split by extraction run delimiter
  const runs = contextText.split(/\n\n---\n\n/)
  const segments: ParsedSegment[] = []

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const runText = runs[runIndex]
    if (!runText.trim()) continue

    const exercises: ParsedExercise[] = []

    // Pattern to match exercise titles:
    //   \textbf{תרגיל N ...} or \section*{תרגיל N ...} or \subsection*{תרגיל N ...}
    //   \textbf{שאלה N ...} / \section*{שאלה N ...} / \subsection*{שאלה N ...}
    //     — Bagrut convention, common in worksheets pointing to exam questions.
    // Secondary shapes (bare numbers, color-wrapped titles, list-wrapped
    // numbers) are handled by additional passes below so this primary regex
    // stays small and the existing captures at match[1..6] keep their meaning.
    const exercisePattern =
      /(?:\\textbf\{((?:תרגיל|שאלה)\s+(\d+)[^}]*)\}|\\section\*?\{((?:תרגיל|שאלה)\s+(\d+)[^}]*)\}|\\subsection\*?\{((?:תרגיל|שאלה)\s+(\d+)[^}]*)\})/g

    // Pattern to match exercises via \setcounter{enumi}{N} followed by \item
    // Does NOT require \begin{enumerate} — handles mid-enumerate setcounter too
    const setCounterPattern = /\\setcounter\{enumi\}\{(\d+)\}\s*\n?\s*\\item\b/g

    // Find all solution boundaries (matches both פתרון תרגיל N and פתרון שאלה N)
    let match
    const solutionPattern =
      /(?:\\section\*?\{(פתרון\s+(?:תרגיל|שאלה)\s+(\d+))\}|\\subsection\*?\{(פתרון\s+(?:תרגיל|שאלה)\s+(\d+))\})/g
    const solutionMatches: Array<{
      index: number
      number: number
      fullMatch: string
    }> = []
    while ((match = solutionPattern.exec(runText)) !== null) {
      const number = parseInt(match[2] || match[4], 10)
      solutionMatches.push({ index: match.index, number, fullMatch: match[0] })
    }

    // Find the start of solutions/post-exercise section. Matches a wider set
    // of "answers" headings the author uses, including plain-text markers
    // inside `\begin{center}\textbf{...}\end{center}` blocks. Once we hit
    // any of these, the anchor scan cuts off — later `\textbf{תרגיל N:}`
    // items belong to the answer key, not to new exercises.
    const solutionsSectionMatch = runText.match(
      /\\(?:section|subsection)\*?\{(?:פתרונות|תשובות)[^}]*\}|\\textbf\{(?:פתרונות|תשובות)[^}]*\}/,
    )
    const solutionsSectionStart = solutionsSectionMatch?.index ?? runText.length
    // Only fall back to the first per-exercise `\section*{פתרון תרגיל N}` as
    // the exercise-end marker when there is NO explicit solutions-section
    // header. Per-exercise solutions can be embedded inline mid-document
    // (author's convention: worked example after ex6, then ex7-10 follow),
    // and cutting off at the first one would drop the remaining exercises.
    const firstSolutionHeader =
      solutionMatches.length > 0 ? solutionMatches[0].index : runText.length
    const firstSolutionIndex = solutionsSectionMatch
      ? solutionsSectionStart
      : firstSolutionHeader

    // Find end of exercise section — "בהצלחה!" after questions marks the boundary
    // (answer summaries and דגשים sections come after it but before solutions)
    // Use the LAST "בהצלחה!" before firstSolutionIndex as the exercise boundary
    let exerciseEndIndex = firstSolutionIndex
    const behatzlachaPattern = /בהצלחה!/g
    let behatzlachaMatch
    while ((behatzlachaMatch = behatzlachaPattern.exec(runText)) !== null) {
      if (behatzlachaMatch.index < firstSolutionIndex) {
        exerciseEndIndex = behatzlachaMatch.index
      }
    }

    // Find all exercise boundaries
    const exerciseMatches: Array<{
      index: number
      title: string
      number: number
      fullMatch: string
    }> = []

    while ((match = exercisePattern.exec(runText)) !== null) {
      // Skip primary matches that land inside the solutions/answer-key
      // region — otherwise `\textbf{תרגיל N:}` entries in the answer key
      // outrank the real `\section*{תרגיל N}` in the body (they're primary
      // matches too), and dedup can pick the wrong chunk when the answer
      // entry's content region ends up longer.
      if (match.index >= exerciseEndIndex) continue
      const title = match[1] || match[3] || match[5]
      const number = parseInt(match[2] || match[4] || match[6], 10)
      exerciseMatches.push({
        index: match.index,
        title,
        number,
        fullMatch: match[0],
      })
    }

    // Track which exercise numbers came from the primary \textbf/\section
    // pattern, so we know to apply phantom-exercise filtering (only safe for
    // that path — secondary-detected exercises without solutions are real,
    // not phantoms).
    const usedPrimaryPattern = exerciseMatches.length > 0
    const primaryNumbers = new Set(exerciseMatches.map((e) => e.number))

    // Also detect \setcounter{enumi}{N} + \item style exercises.
    // Runs even when primary pattern matched, because LLM page-by-page extraction
    // commonly emits a single \textbf{תרגיל 1} on page 1 and continues with
    // \setcounter{enumi}{N} / \item-style continuations for exercises 2..N.
    // De-dup by exercise number happens within each pass below.
    // Pass 1: Find all \setcounter{enumi}{N}\item anchors
    while ((match = setCounterPattern.exec(runText)) !== null) {
      if (match.index >= exerciseEndIndex) continue

      const enumi = parseInt(match[1], 10)
      const number = enumi + 1 // \setcounter{enumi}{0} means exercise 1

      // Skip if the primary \textbf/\section pattern already matched this
      // number — its descriptive title and document position must be
      // preserved so reconstructContextText can write back faithfully.
      // Replacing it with a setCounter token would destroy the original
      // header on save.
      if (exerciseMatches.some((e) => e.number === number)) continue

      exerciseMatches.push({
        index: match.index,
        title: `תרגיל ${number}`,
        number,
        fullMatch: match[0],
      })
    }

    // Pass 1b: Find \item[N.] bracket-numbered exercises
    const itemBracketPattern = /\\item\[(\d+)\.\]/g
    while ((match = itemBracketPattern.exec(runText)) !== null) {
      if (match.index >= exerciseEndIndex) continue
      const number = parseInt(match[1], 10)
      if (exerciseMatches.some((e) => e.number === number)) continue
      exerciseMatches.push({
        index: match.index,
        title: `תרגיל ${number}`,
        number,
        fullMatch: match[0],
      })
    }

    // Pass 1c: Find \item N. inline-numbered exercises (e.g., "\item 42. content")
    const itemInlinePattern = /\\item\s+(\d+)\.\s/g
    while ((match = itemInlinePattern.exec(runText)) !== null) {
      if (match.index >= exerciseEndIndex) continue
      const number = parseInt(match[1], 10)
      if (exerciseMatches.some((e) => e.number === number)) continue
      exerciseMatches.push({
        index: match.index,
        title: `תרגיל ${number}`,
        number,
        fullMatch: match[0].trimEnd(),
      })
    }

    // Passes 1d–1g upsert with "prefer earlier position" semantics. This
    // matters when the same number appears both in the exercise body and in
    // an answer-key `\textbf{שאלה N:}` block near the end of the document —
    // dedup by "first pass wins" would keep the answer-key anchor (matched
    // by the primary pass) and discard the actual exercise (and its tikz).
    // Preferring the earliest document position picks the exercise body
    // anchor over the trailing answer-key one.
    const upsertEarliest = (
      index: number,
      title: string,
      number: number,
      fullMatch: string,
    ): void => {
      const existingIdx = exerciseMatches.findIndex((e) => e.number === number)
      if (existingIdx === -1) {
        exerciseMatches.push({ index, title, number, fullMatch })
        return
      }
      if (index < exerciseMatches[existingIdx].index) {
        exerciseMatches[existingIdx] = { index, title, number, fullMatch }
      }
    }

    // Pass 1d: `\section*{N. text}` — bare-number section titles used by the
    // author. Restrict N to 1..99 so year-like `\section*{2024. ...}` doesn't
    // become an exercise anchor.
    const bareSectionPattern = /\\(?:section|subsection)\*?\{\s*(\d{1,2})\.\s+[^}]{1,200}\}/g
    while ((match = bareSectionPattern.exec(runText)) !== null) {
      if (match.index >= exerciseEndIndex) continue
      const number = parseInt(match[1], 10)
      upsertEarliest(match.index, `תרגיל ${number}`, number, match[0])
    }

    // Pass 1e: `\textbf{N. inline text}` — bare-number bold intros. Used
    // heavily inside minipage/flushright columns in PDF-style worksheets.
    const bareTextbfPattern = /\\textbf\{\s*(\d{1,2})\.\s+[^}]{1,200}\}/g
    while ((match = bareTextbfPattern.exec(runText)) !== null) {
      if (match.index >= exerciseEndIndex) continue
      const number = parseInt(match[1], 10)
      upsertEarliest(match.index, `תרגיל ${number}`, number, match[0])
    }

    // Pass 1f: `\textbf{N.}` standalone bold number — the pattern used inside
    // `\begin{list}{\textbf{N.}}{...}` PDF-worksheet exercise wrappers.
    const standaloneTextbfPattern = /\\textbf\{\s*(\d{1,2})\.\s*\}/g
    while ((match = standaloneTextbfPattern.exec(runText)) !== null) {
      if (match.index >= exerciseEndIndex) continue
      const number = parseInt(match[1], 10)
      upsertEarliest(match.index, `תרגיל ${number}`, number, match[0])
    }

    // Pass 1g: color-wrapped section titles like `\section*{{\color{name} תרגיל N ...}}`.
    // The primary regex above uses `[^}]*` for the title body, so nested
    // `{\color{...}}` groups break the match. Recognize the wrapped form
    // explicitly here.
    const colorWrappedPattern =
      /\\(?:section|subsection)\*?\{\s*\{\s*\\color\{[^}]*\}\s*((?:תרגיל|שאלה)\s+(\d+)[^}]*)\}\s*\}/g
    while ((match = colorWrappedPattern.exec(runText)) !== null) {
      if (match.index >= exerciseEndIndex) continue
      const number = parseInt(match[2], 10)
      upsertEarliest(match.index, match[1].trim(), number, match[0])
    }

    // Pass 2: Find continuation exercises (plain \item after a known exercise)
    // Scan ALL detected exercises, not just those missing the next number
    const foundNumbers = new Set(exerciseMatches.map((e) => e.number))
    const continuations: typeof exerciseMatches = []
    for (const ex of exerciseMatches) {
      if (foundNumbers.has(ex.number + 1)) continue
      // Anchors of the form `\textbf{N.}` (standalone) come from PDF
      // worksheet wrappers `\begin{list}{\textbf{N.}}{...}\item body\end{list}`.
      // The list contains exactly one `\item` (the exercise intro) — treating
      // it as a "continuation exercise" would produce a phantom N+1.
      if (/^\\textbf\{\s*\d{1,2}\.\s*\}$/.test(ex.fullMatch)) continue

      const searchStart = ex.index + ex.fullMatch.length
      const region = runText.slice(searchStart, exerciseEndIndex)

      let level = 0
      let exerciseNum = ex.number
      // Also track `\begin{list}` / `\end{list}` so PDF-worksheet exercise
      // wrappers (`\begin{list}{\textbf{N.}}{...} \item intro \end{list}`)
      // don't misread the intro `\item` as a continuation exercise. The
      // anchor is INSIDE the list; the first `\end{list}` we hit means we've
      // exited the wrapper and there's no continuation to find here.
      const tokenPattern =
        /\\begin\{enumerate\}(\[[^\]]*\])?|\\end\{enumerate\}|\\begin\{list\}|\\end\{list\}|\\setcounter\{enumi\}\{\d+\}|\\item\b/g
      let tokenMatch
      while ((tokenMatch = tokenPattern.exec(region)) !== null) {
        if (tokenMatch[0].startsWith('\\begin{enumerate}')) {
          level++
          // Sub-enumerate blocks with [label=...] are sub-items, not exercises
          if (level === 1 && tokenMatch[1]) {
            // Skip the entire sub-block
            let subLevel = 1
            while (subLevel > 0 && (tokenMatch = tokenPattern.exec(region)) !== null) {
              if (tokenMatch[0].startsWith('\\begin{enumerate}')) subLevel++
              else if (tokenMatch[0] === '\\end{enumerate}') subLevel--
            }
            level--
            continue
          }
        } else if (tokenMatch[0] === '\\end{enumerate}') {
          level--
          if (level < 0) break // Exited the containing enumerate block
        } else if (tokenMatch[0] === '\\begin{list}') {
          level++
        } else if (tokenMatch[0] === '\\end{list}') {
          level--
          if (level < 0) break // Exited the containing list wrapper
        } else if (tokenMatch[0].startsWith('\\setcounter')) {
          // A setcounter means the next item has an explicit number — stop continuation
          break
        } else if (tokenMatch[0] === '\\item' && level === 0) {
          exerciseNum++
          const absIndex = searchStart + tokenMatch.index
          if (
            absIndex >= exerciseEndIndex ||
            foundNumbers.has(exerciseNum) ||
            continuations.some((e) => e.number === exerciseNum)
          ) {
            continue
          }
          continuations.push({
            index: absIndex,
            title: `תרגיל ${exerciseNum}`,
            number: exerciseNum,
            fullMatch: tokenMatch[0],
          })
          foundNumbers.add(exerciseNum)
          // Don't break — continue finding more continuations
        }
      }
    }
    exerciseMatches.push(...continuations)

    // Pass 3: Fill remaining gaps with orphan enumerate blocks
    const allFound = new Set(exerciseMatches.map((e) => e.number))
    if (exerciseMatches.length > 0) {
      const maxNum = Math.max(...exerciseMatches.map((e) => e.number))
      const byPos = [...exerciseMatches].sort((a, b) => a.index - b.index)

      for (let gapStart = 1; gapStart <= maxNum; gapStart++) {
        if (allFound.has(gapStart)) continue
        let gapEnd = gapStart
        while (gapEnd + 1 <= maxNum && !allFound.has(gapEnd + 1)) gapEnd++
        const gapCount = gapEnd - gapStart + 1

        const prevEx = byPos.filter((e) => e.number < gapStart).pop()
        const nextEx = byPos.find((e) => e.number > gapEnd)
        const regionStart = prevEx ? prevEx.index + prevEx.fullMatch.length : 0
        const regionEnd = nextEx ? nextEx.index : exerciseEndIndex
        const region = runText.slice(regionStart, regionEnd)

        const orphanItems: number[] = []
        let level = 0
        let inOrphan = false
        const tokPat =
          /\\begin\{enumerate\}(\[[^\]]*\])?|\\end\{enumerate\}|\\setcounter\{enumi\}|\\item\b/g
        let tok
        while ((tok = tokPat.exec(region)) !== null) {
          if (tok[0].startsWith('\\begin{enumerate}')) {
            level++
            if (level === 1) {
              inOrphan = !tok[1]
            }
          } else if (tok[0] === '\\end{enumerate}') {
            if (level === 1) inOrphan = false
            level--
            if (level < 0) level = 0
          } else if (tok[0].startsWith('\\setcounter')) {
            if (level === 1) inOrphan = false
          } else if (tok[0] === '\\item' && level === 1 && inOrphan) {
            orphanItems.push(regionStart + tok.index)
          }
        }

        const toAssign = Math.min(orphanItems.length, gapCount)
        for (let i = 0; i < toAssign; i++) {
          const num = gapStart + i
          exerciseMatches.push({
            index: orphanItems[i],
            title: `תרגיל ${num}`,
            number: num,
            fullMatch: '\\item',
          })
          allFound.add(num)
        }

        gapStart = gapEnd
      }
    }

    // Sort by exercise number for consistent display order
    exerciseMatches.sort((a, b) => a.number - b.number)

    if (exerciseMatches.length === 0) {
      // No exercises found — treat entire text as one exercise
      exercises.push({
        number: 1,
        title: 'תרגיל 1',
        header: '',
        latexContent: runText,
        solution: null,
        solutionHeader: null,
        hasDiagram: hasDiagramCheck(runText),
        startIndex: 0,
        endIndex: runText.length,
      })
    } else {
      // Sort by text position for correct content boundary slicing
      const byPosition = [...exerciseMatches].sort((a, b) => a.index - b.index)

      // Process each exercise
      for (let i = 0; i < exerciseMatches.length; i++) {
        const current = exerciseMatches[i]
        // Find the next exercise by text position (not by number) for content boundary
        const posIdx = byPosition.indexOf(current)
        const nextByPos = posIdx < byPosition.length - 1 ? byPosition[posIdx + 1] : null

        // Content starts after the exercise header
        const contentStart = current.index + current.fullMatch.length
        // Content ends at the next exercise boundary (by position), solutions section, or end of text
        const contentEnd = nextByPos ? nextByPos.index : firstSolutionIndex

        const latexContent = runText.slice(contentStart, contentEnd).trim()

        // Find matching solution — prefer the longest match when duplicates exist
        const solCandidates = solutionMatches.filter((s) => s.number === current.number)
        let solution: string | null = null
        let solutionHeader: string | null = null
        for (const solMatch of solCandidates) {
          const solContentStart = solMatch.index + solMatch.fullMatch.length
          const nextSol = solutionMatches.find((s) => s.index > solMatch.index)
          const solContentEnd = nextSol ? nextSol.index : runText.length
          const candidate = runText.slice(solContentStart, solContentEnd).trim()
          if (candidate.length > (solution?.length ?? 0)) {
            solutionHeader = solMatch.fullMatch
            solution = candidate
          }
        }

        exercises.push({
          number: current.number,
          title: current.title,
          header: current.fullMatch,
          latexContent,
          solution,
          solutionHeader,
          hasDiagram: hasDiagramCheck(latexContent),
          startIndex: current.index,
          endIndex: contentEnd,
        })
      }
    }

    // For the primary \textbf{תרגיל N} pattern only: dedup by exercise number
    // (keeping the longest content variant), then if any exercise in this run
    // has a matched solution, drop phantom PRIMARY matches that lack one. Why:
    // the page-by-page LLM extraction occasionally emits stray \textbf{תרגיל N}
    // headers over answer-summary fragments or sub-item labels (ה. ו.) that
    // never get a corresponding \section*{פתרון תרגיל N}. Secondary-detected
    // exercises (setCounter / continuation / orphan-fill) are NOT subject to
    // this filter — they're real continuations of a numbered list and may
    // legitimately lack their own solution header in the source.
    let finalExercises = exercises
    if (usedPrimaryPattern) {
      const byNumber = new Map<number, ParsedExercise>()
      for (const ex of exercises) {
        const existing = byNumber.get(ex.number)
        if (!existing || ex.latexContent.length > existing.latexContent.length) {
          byNumber.set(ex.number, ex)
        }
      }
      const dedup = Array.from(byNumber.values())
      // Only fire the phantom filter when MOST primary matches have their own
      // solution header. If just one or two do (e.g., an inline sample
      // solution embedded mid-document), the "phantoms" are real exercises
      // that simply lack a per-exercise solution — dropping them would gut
      // the file. Require ≥50% coverage.
      const primaryWithSolution = dedup.filter(
        (ex) => ex.solution !== null && primaryNumbers.has(ex.number),
      ).length
      const primaryCount = dedup.filter((ex) => primaryNumbers.has(ex.number)).length
      const coverageOk = primaryCount > 0 && primaryWithSolution / primaryCount >= 0.5
      if (coverageOk) {
        finalExercises = dedup.filter(
          (ex) => ex.solution !== null || !primaryNumbers.has(ex.number),
        )
      } else {
        finalExercises = dedup
      }
    }

    segments.push({
      exercises: finalExercises,
      extractionIndex: runIndex + 1,
      originalText: runText,
    })
  }

  return segments
}

/**
 * Reconstruct the full ContextExtractions text from edited segments.
 * Rebuilds each run by replacing exercise/solution content while preserving
 * the document preamble, headers, and delimiters.
 */
export function reconstructContextText(segments: ParsedSegment[]): string {
  const runs: string[] = []

  for (const segment of segments) {
    const runText = segment.originalText
    const { exercises } = segment

    // If only one exercise with no header, the entire run IS the content
    if (exercises.length === 1 && !exercises[0].header) {
      runs.push(exercises[0].latexContent)
      continue
    }

    // Find preamble (everything before first exercise)
    const firstExercise = exercises[0]
    const preamble = runText.slice(0, firstExercise.startIndex)

    // Rebuild: preamble + exercises + solutions
    const parts: string[] = [preamble]

    for (const ex of exercises) {
      parts.push(ex.header)
      parts.push('\n')
      parts.push(ex.latexContent)
      parts.push('\n\n')
    }

    // Rebuild solutions section
    for (const ex of exercises) {
      if (ex.solution !== null && ex.solutionHeader) {
        parts.push(ex.solutionHeader)
        parts.push('\n')
        parts.push(ex.solution)
        parts.push('\n\n')
      }
    }

    // Check if there's a \end{document} that should be preserved
    if (runText.includes('\\end{document}') && !parts.some((p) => p.includes('\\end{document}'))) {
      parts.push('\\end{document}\n')
    }

    runs.push(parts.join(''))
  }

  return runs.join('\n\n---\n\n')
}
