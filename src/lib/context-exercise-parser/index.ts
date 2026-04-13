/**
 * Context Exercise Parser
 *
 * Parses lessonContextText (LaTeX) into structured exercise segments.
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

    // Pattern to match exercise titles: \textbf{תרגיל N ...} or \section*{תרגיל N ...}
    const exercisePattern =
      /(?:\\textbf\{(תרגיל\s+(\d+)[^}]*)\}|\\section\*?\{(תרגיל\s+(\d+)[^}]*)\}|\\subsection\*?\{(תרגיל\s+(\d+)[^}]*)\})/g

    // Find all exercise boundaries
    const exerciseMatches: Array<{
      index: number
      title: string
      number: number
      fullMatch: string
    }> = []

    let match
    while ((match = exercisePattern.exec(runText)) !== null) {
      const title = match[1] || match[3] || match[5]
      const number = parseInt(match[2] || match[4] || match[6], 10)
      exerciseMatches.push({
        index: match.index,
        title,
        number,
        fullMatch: match[0],
      })
    }

    // Find all solution boundaries
    const solutionPattern =
      /(?:\\section\*?\{(פתרון\s+תרגיל\s+(\d+))\}|\\subsection\*?\{(פתרון\s+תרגיל\s+(\d+))\})/g
    const solutionMatches: Array<{
      index: number
      number: number
      fullMatch: string
    }> = []
    while ((match = solutionPattern.exec(runText)) !== null) {
      const number = parseInt(match[2] || match[4], 10)
      solutionMatches.push({ index: match.index, number, fullMatch: match[0] })
    }

    // Find the start of solutions section (first solution header)
    const firstSolutionIndex =
      solutionMatches.length > 0 ? solutionMatches[0].index : runText.length

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
      // Process each exercise
      for (let i = 0; i < exerciseMatches.length; i++) {
        const current = exerciseMatches[i]
        const next = exerciseMatches[i + 1]

        // Content starts after the exercise header
        const contentStart = current.index + current.fullMatch.length
        // Content ends at the next exercise boundary, solutions section, or end of text
        const contentEnd = next ? next.index : firstSolutionIndex

        const latexContent = runText.slice(contentStart, contentEnd).trim()

        // Find matching solution
        const solMatch = solutionMatches.find((s) => s.number === current.number)
        let solution: string | null = null
        let solutionHeader: string | null = null
        if (solMatch) {
          solutionHeader = solMatch.fullMatch
          const solContentStart = solMatch.index + solMatch.fullMatch.length
          // Solution ends at next solution or end of text
          const nextSol = solutionMatches.find((s) => s.index > solMatch.index)
          const solContentEnd = nextSol ? nextSol.index : runText.length
          solution = runText.slice(solContentStart, solContentEnd).trim()
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

    segments.push({
      exercises,
      extractionIndex: runIndex + 1,
      originalText: runText,
    })
  }

  return segments
}

/**
 * Reconstruct the full lessonContextText from edited segments.
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
