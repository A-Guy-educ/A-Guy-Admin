import { describe, it, expect } from 'vitest'
import { parseLatexToBlocks, parseLatexToExercises } from '@/lib/latex-parser'
import { isExerciseTitle } from '@/lib/latex-parser/enumerate-parser'

describe('parseLatexToBlocks', () => {
  it('parses a complete exam.cls document', () => {
    const latex = `
\\section{Algebra}
\\begin{questions}
\\question What is $2+2$?
\\begin{choices}
\\choice 3
\\CorrectChoice 4
\\choice 5
\\choice 6
\\end{choices}
\\question What is $3 \\times 3$?
\\begin{choices}
\\choice 6
\\CorrectChoice 9
\\choice 12
\\choice 15
\\end{choices}
\\end{questions}
`
    const result = parseLatexToBlocks(latex)
    expect(result.errors).toHaveLength(0)
    const mcqBlocks = result.blocks.filter((b) => b.type === 'question_select')
    expect(mcqBlocks).toHaveLength(2)
  })

  it('preserves unparseable content as rich_text with warning', () => {
    const latex = '\\begin{weirdenv}\nsome content\n\\end{weirdenv}'
    const result = parseLatexToBlocks(latex)
    expect(result.warnings.length).toBeGreaterThan(0)
    const richTexts = result.blocks.filter((b) => b.type === 'rich_text')
    expect(richTexts.length).toBeGreaterThan(0)
  })

  it('rejects dangerous commands', () => {
    const latex = '\\input{evil.tex}\n\\item Question'
    const result = parseLatexToBlocks(latex)
    expect(result.errors).toHaveLength(1)
    expect(result.blocks).toHaveLength(0)
  })

  it('handles empty input', () => {
    const result = parseLatexToBlocks('')
    expect(result.blocks).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('handles standalone display math as rich_text with $$ delimiters', () => {
    const latex = '$$\\int_0^1 x^2 dx = \\frac{1}{3}$$'
    const result = parseLatexToBlocks(latex)
    const mathBlocks = result.blocks.filter((b) => b.type === 'rich_text' && b.value.includes('$$'))
    expect(mathBlocks).toHaveLength(1)
  })

  it('handles mixed content with text and questions', () => {
    const latex = `
Solve the following:

\\question What is $x$ if $2x = 10$?
\\begin{choices}
\\choice 3
\\CorrectChoice 5
\\choice 7
\\choice 10
\\end{choices}

Remember to show your work.
`
    const result = parseLatexToBlocks(latex)
    expect(result.blocks.length).toBeGreaterThanOrEqual(2)
  })
})

describe('isExerciseTitle — Hebrew "שאלה" patterns', () => {
  // The answer-key convention in Hebrew worksheets uses `\textbf{שאלה N:}` per
  // answer, and this hadn't matched before — it needs to be recognized as an
  // exercise boundary so the multi-exercise splitter picks it up.
  it('matches \\textbf{שאלה N:} as exercise title', () => {
    const result = isExerciseTitle('\\textbf{שאלה 1:}')
    expect(result).not.toBeNull()
    expect(result?.number).toBe(1)
  })

  it('matches \\textbf{שאלה N} (no colon)', () => {
    const result = isExerciseTitle('\\textbf{שאלה 12}')
    expect(result).not.toBeNull()
    expect(result?.number).toBe(12)
  })

  it('matches \\textbf{שאלה N - Title}', () => {
    const result = isExerciseTitle('\\textbf{שאלה 3 - Parabolas}')
    expect(result).not.toBeNull()
    expect(result?.number).toBe(3)
  })
})

describe('\\begin{list}{\\textbf{N.}} — numbered exercise wrapper', () => {
  // Hebrew PDF worksheets frequently wrap the exercise number + intro paragraph
  // in `\begin{list}{\textbf{N.}}{...}\item <intro>\end{list}` for tight
  // custom formatting. Previously this env fell through to rich_text with a
  // warning, and the exercise splitter never saw a boundary.
  it('emits `## תרגיל N` heading and processes item content', () => {
    const latex = `
\\begin{list}{\\textbf{1.}}{\\setlength{\\rightmargin}{0.5em}}
\\item Intro paragraph for exercise one.
\\end{list}
`
    const result = parseLatexToBlocks(latex)
    const headings = result.blocks.filter(
      (b) => b.type === 'rich_text' && b.value.startsWith('## תרגיל'),
    )
    expect(headings).toHaveLength(1)
    expect(headings[0].type === 'rich_text' && headings[0].value).toBe('## תרגיל 1')
    const paragraphs = result.blocks.filter(
      (b) => b.type === 'rich_text' && b.value.includes('Intro paragraph'),
    )
    expect(paragraphs.length).toBeGreaterThan(0)
  })

  it('splits a multi-exercise PDF-style file on list-wrapped numbers', () => {
    // Shape mirrors the two-column PDF worksheet: each exercise is
    // `\begin{minipage}\begin{list}{\textbf{N.}}...\end{list}\begin{enumerate}...\end{enumerate}\end{minipage}`.
    const latex = `
\\begin{minipage}[t]{0.56\\textwidth}
\\begin{list}{\\textbf{1.}}{}
\\item Intro one.
\\end{list}
\\begin{enumerate}
\\item Sub-question 1a.
\\item Sub-question 1b.
\\end{enumerate}
\\end{minipage}

\\begin{minipage}[t]{0.56\\textwidth}
\\begin{list}{\\textbf{2.}}{}
\\item Intro two.
\\end{list}
\\begin{enumerate}
\\item Sub-question 2a.
\\end{enumerate}
\\end{minipage}
`
    const result = parseLatexToExercises(latex)
    expect(result.errors).toHaveLength(0)
    expect(result.exercises.length).toBeGreaterThanOrEqual(2)
    expect(result.exercises[0].number).toBe(1)
    expect(result.exercises[1].number).toBe(2)
  })

  it('splits an answer key on \\textbf{שאלה N:} boundaries', () => {
    const latex = `
\\textbf{שאלה 1:} \\\\
Answer to question one.

\\textbf{שאלה 2:} \\\\
Answer to question two.
`
    const result = parseLatexToExercises(latex)
    expect(result.errors).toHaveLength(0)
    expect(result.exercises.length).toBe(2)
    expect(result.exercises[0].number).toBe(1)
    expect(result.exercises[1].number).toBe(2)
  })
})

describe('Boss-format patterns — bare numbers, color wrappers, itemize sub-questions', () => {
  // Hebrew worksheet authors commonly title an exercise with just a bare
  // number followed by the intro paragraph, e.g. `\textbf{1. פשטו את...}`.
  // Previously this only matched when the closing `}` was right after the
  // period, which broke on this very common inline shape.
  it('matches \\textbf{N. inline intro text} as exercise title', () => {
    const result = isExerciseTitle('\\textbf{3. \\quad נתונות הפונקציות:}')
    expect(result).not.toBeNull()
    expect(result?.number).toBe(3)
  })

  it('matches \\section*{N. text} as exercise title', () => {
    const result = isExerciseTitle('\\section*{1. ענו על הסעיפים הבאים:}')
    expect(result).not.toBeNull()
    expect(result?.number).toBe(1)
  })

  it('matches \\section*{{\\color{name} תרגיל N}} (color-wrapped title)', () => {
    const result = isExerciseTitle('\\section*{{\\color{explanation} תרגיל 5}}')
    expect(result).not.toBeNull()
    expect(result?.number).toBe(5)
  })

  it('rejects \\textbf{2024.} — four-digit numbers are not exercise anchors', () => {
    const result = isExerciseTitle('\\textbf{2024.}')
    expect(result).toBeNull()
  })

  it('splits a file whose exercise titles use \\section*{N. text}', () => {
    const latex = `
\\begin{document}
\\section*{1. Solve the equation:}
\\[ x^2 - 5x + 6 = 0 \\]

\\section*{2. Factor the polynomial:}
\\[ x^3 - x \\]
\\end{document}
`
    const result = parseLatexToExercises(latex)
    expect(result.errors).toHaveLength(0)
    const numberedExercises = result.exercises.filter((e) => e.number > 0)
    expect(numberedExercises.length).toBe(2)
    expect(numberedExercises[0].number).toBe(1)
    expect(numberedExercises[1].number).toBe(2)
  })

  it('splits a file whose exercise titles use \\section*{{\\color{...} תרגיל N}}', () => {
    const latex = `
\\begin{document}
\\section*{{\\color{explanation} תרגיל 1}}
Content of exercise 1.

\\section*{{\\color{explanation} תרגיל 2}}
Content of exercise 2.
\\end{document}
`
    const result = parseLatexToExercises(latex)
    expect(result.errors).toHaveLength(0)
    const numberedExercises = result.exercises.filter((e) => e.number > 0)
    expect(numberedExercises.length).toBe(2)
    expect(numberedExercises[0].number).toBe(1)
    expect(numberedExercises[1].number).toBe(2)
  })

  // Hebrew PDF worksheets often use `itemize` with explicit `\item[\textbf{א.}]`
  // labels as a sub-question list. Previously the parser collapsed those to
  // bullet-point rich text, losing the per-item free-response structure.
  it('treats itemize with explicit Hebrew alph labels as sub-questions', () => {
    const latex = `
\\begin{itemize}[label={}, itemsep=5pt]
\\item[\\textbf{א.}] מצאו את שטח משולש ACD.
\\item[\\textbf{ב.}] מצאו את שטח משולש BEF.
\\item[\\textbf{ג.}] עבור אילו ערכי x, הפונקציה עולה?
\\end{itemize}
`
    const result = parseLatexToBlocks(latex)
    const freeResponse = result.blocks.filter((b) => b.type === 'question_free_response')
    expect(freeResponse.length).toBe(3)
  })

  it('still collapses plain itemize (no explicit labels) into bullet text', () => {
    const latex = `
\\begin{itemize}
\\item First point.
\\item Second point.
\\end{itemize}
`
    const result = parseLatexToBlocks(latex)
    const freeResponse = result.blocks.filter((b) => b.type === 'question_free_response')
    expect(freeResponse.length).toBe(0)
    const richText = result.blocks.filter((b) => b.type === 'rich_text')
    expect(richText.length).toBeGreaterThan(0)
    const bullets = richText.find((b) => b.type === 'rich_text' && b.value.includes('•'))
    expect(bullets).toBeDefined()
  })

  it('recurses into \\begin{RTL}...\\end{RTL} so inner titles are still detected', () => {
    const latex = `
\\begin{document}
\\begin{RTL}
\\textbf{1.} First exercise intro.
\\end{RTL}
\\begin{RTL}
\\textbf{2.} Second exercise intro.
\\end{RTL}
\\end{document}
`
    const result = parseLatexToExercises(latex)
    expect(result.errors).toHaveLength(0)
    const numberedExercises = result.exercises.filter((e) => e.number > 0)
    expect(numberedExercises.length).toBe(2)
  })
})
