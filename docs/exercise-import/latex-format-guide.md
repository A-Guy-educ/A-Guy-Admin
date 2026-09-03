# LaTeX (.tex) Format Guide

How to structure a `.tex` file so it imports correctly via the deterministic parser at [`src/lib/latex-parser/`](../../src/lib/latex-parser/).

Used by:

- The **Full Convert (LaTeX)** button on the lesson edit view (when a `.tex` is attached to `lesson.contentFiles`)
- The **Import Lessons** page at `/admin/lesson-json-import` (drop `.tex` files directly)

Both flows delegate to `runFullLatexPipeline`, which reads the file → splits it into exercises via the deterministic parser → converts each exercise's LaTeX blocks into typed blocks. An AI fallback fires per-exercise when the deterministic parser produces "unmeaningful" output (< 10% of source captured, or < 10 chars total).

---

## Exercise boundaries (CRITICAL)

Without at least one recognized exercise-boundary anchor, the whole file becomes **one** exercise with a big rich_text blob.

### Patterns the parser recognizes

```latex
% ✅ Any of these will trigger an exercise split:

\textbf{תרגיל 1}
\textbf{תרגיל 1 - Title}
\textbf{שאלה 1}
\textbf{שאלה 1:}
\textbf{שאלה 1 - Title}

\section*{תרגיל 1}
\section*{תרגיל 1: Title}
\subsection*{תרגיל 1}
\section*{שאלה 1}
\subsection*{שאלה 1}

\textbf{1.}    % bare standalone numbered exercise

% ✅ Also works — very common in PDF worksheets that need tight
% custom formatting around the exercise number:
\begin{list}{\textbf{1.}}{...list config...}
\item <exercise intro paragraph>
\end{list}
```

### Patterns that do NOT trigger a split

```latex
% ❌ These become rich_text without splitting:

\textbf{Exercise 1}                   % English "Exercise", not Hebrew
\textbf{Q1}
1.  <intro>                            % bare number, no \textbf wrapper
```

---

## Sub-questions (enumerate)

Use `enumerate` — the parser turns each `\item` into a `question_free_response` block.

```latex
% ✅ Simplest form — works
\begin{enumerate}
\item מצאו את שיעורי נקודות החיתוך A ו-B.
\item מצאו את הקודקוד C.
\end{enumerate}

% ✅ enumitem with \alph* labels
\begin{enumerate}[label=\textbf{\alph*.}]
\item First sub-question
\item Second sub-question
\end{enumerate}

% ✅ Continuation from a previous list
\begin{enumerate}[label=\textbf{\alph*.}, start=3]
\item Third sub-question
\end{enumerate}

% ✅ Extra options don't break parsing
\begin{enumerate}[leftmargin=\seifIndent]
\item Sub-question with custom margin.
\end{enumerate}
```

**Frontend numbers automatically** — don't manually prefix `\item` bodies with `א.`, `ב.`, `1.`, etc.

---

## MCQ (multiple choice)

Three MCQ styles are recognized. Pick whichever your source uses.

### exam.cls (`\question` + `\choices`)

```latex
\begin{questions}
\question What is $2 + 2$?
\begin{choices}
\choice 3
\CorrectChoice 4
\choice 5
\choice 6
\end{choices}
\end{questions}
```

### enumitem-nested

Prompt on the outer `\item`, options as a nested `enumerate` with `\arabic*` labels:

```latex
\begin{enumerate}[label=\textbf{\alph*.}]
\item Which is correct?
    \begin{enumerate}[label=(\textbf{\arabic*})]
    \item Option A
    \item Option B
    \item Option C
    \end{enumerate}
\end{enumerate}
```

### Inline `\choice`-style

Also detected — see `mcq-inline.ts` for the exact patterns.

**Marking the correct answer**: `\CorrectChoice` is the standard signal. Without it, the parser can still create the MCQ but the "correct" flag defaults to the first option — always check before publishing.

---

## Tables

`tabular` and `tabular*` are converted to `question_table` blocks:

```latex
\begin{tabular}{|c|c|c|c|}
\hline
\textbf{Header 1} & \textbf{Header 2} & \textbf{Header 3} \\ \hline
value 1 & value 2 & value 3 \\ \hline
\end{tabular}
```

If a `tabular` contains embedded `tikzpicture` blocks (e.g. an option-grid of graphs), the parser extracts each diagram as its own block.

---

## Diagrams — TikZ axis (pgfplots)

Use `pgfplots` `\begin{axis}` inside `\begin{tikzpicture}`. The parser extracts viewport, functions, points, and axis labels into a `question_axis` block.

```latex
\selectlanguage{english}
\begin{tikzpicture}[scale=0.8]
\begin{axis}[
    axis lines=middle,
    xlabel={$x$}, ylabel={$y$},
    xmin=-3, xmax=6, ymin=-2, ymax=11,
    ticks=none,
    enlargelimits=false
]
    \addplot[domain=-2:6, samples=100, thick] {-x^2 + 4*x + 5};
    \fill (axis cs: -1, 0) circle (2pt) node[above left] {$A$};
    \fill (axis cs: 4, 5) circle (2pt) node[above right] {$B$};
\end{axis}
\end{tikzpicture}
\selectlanguage{hebrew}
```

Notes:

- **Wrap in `\selectlanguage{english}` / `\selectlanguage{hebrew}`** to prevent RTL axis flip when Hebrew is the main language.
- Set `xmin`/`xmax`/`ymin`/`ymax` explicitly — otherwise the renderer picks bounds from the elements.
- `xtick` / `ytick` with brace-grouped values (`xtick={0,10,20}`) are supported.

## Diagrams — TikZ geometry (raw draws)

Raw `tikzpicture` with `\coordinate`, `\draw`, `\fill`, and `\tkzMarkRightAngle` is parsed to a `question_geometry` block:

```latex
\selectlanguage{english}
\begin{tikzpicture}[scale=0.4]
\coordinate (A) at (-6, 14);
\coordinate (B) at (4.5, 0);
\coordinate (C) at (12.5, 6);

\draw[thick] (A) -- (B) -- (C) -- cycle;

\fill (A) circle (4pt) node[above] {A};
\fill (B) circle (4pt) node[below] {B};
\fill (C) circle (4pt) node[right] {C};

\tkzMarkRightAngle(A,B,C)
\end{tikzpicture}
\selectlanguage{hebrew}
```

## Diagrams — `\draw plot` (raw TikZ functions)

For function graphs drawn with raw TikZ `\draw plot` syntax (no `\begin{axis}` wrapper):

```latex
\draw[domain=-3:3, samples=100, thick, smooth] plot (\x, {-(\x*\x)*(\x*\x - 9)/4});
```

---

## Math

Inline and display math are preserved verbatim — the frontend renders via KaTeX:

```latex
Inline: $f(x) = x^2$
Display: $$\int_0^1 f(x)\,dx = \frac{1}{3}$$
```

Color commands inside math (`{\color{winered}$x^2$}`) are stripped by the parser — the frontend handles color separately.

---

## Layout wrappers (transparent)

These wrappers are **recursed into** — their inner content is processed as if the wrapper wasn't there. Safe to use for PDF formatting:

- `\begin{document} ... \end{document}` (preamble before `\begin{document}` is stripped)
- `\begin{center}` / `\begin{flushleft}` / `\begin{flushright}`
- `\begin{minipage}[t]{...}` — commonly used for two-column layout in Hebrew worksheets. Both columns are processed linearly.
- `\begin{spacing}`

## Layout wrappers with special meaning

- `\begin{list}{\textbf{N.}}{...} \item <intro> \end{list}` — the `\textbf{N.}` label triggers an exercise boundary (emits `## תרגיל N` and starts a new exercise), then the `\item` content is processed as the exercise intro. This is the standard Hebrew PDF worksheet pattern.
- `\begin{itemize}` — converted to bullet-point rich text (`• item 1\n• item 2`).
- `\begin{enumerate}` — see [Sub-questions](#sub-questions-enumerate) above.

---

## Silently stripped

Preamble noise, formatting commands, and layout hints are dropped without warning:

**Commands**: `\documentclass`, `\usepackage`, `\newcommand`, `\renewcommand`, `\title`, `\author`, `\maketitle`, `\pagestyle`, `\setlength`, `\geometry`, `\fancyhf`, `\definecolor`, `\color`, `\linespread`, `\newfontfamily`, `\setmainlanguage`, `\setotherlanguage`, `\usetikzlibrary`, `\pgfplotsset`, `\selectlanguage`, `\noindent`, `\vspace`, `\hspace`, `\hfill`, `\vfill`, `\newpage`, `\clearpage`, `\bigskip`, `\medskip`, `\smallskip`, `\LARGE`, `\large`, `\Large`, `\normalsize`, `\small`, `\footnotesize`, `\tiny`, `\centering`, `\begingroup`, `\endgroup`.

**Text formatting** (converted to markdown, not stripped): `\textbf{x}` → `**x**`, `\textit{x}` / `\emph{x}` → `*x*`, `\underline{x}` / `\text{x}` → `x`.

**Text substitutions**: `\\` (line break) → space, `\quad` → space (via whitespace collapse).

---

## What still blobs

If your content uses any of these, the offending chunk falls through to `rich_text` with a warning:

| Construct | Why it blobs | Workaround |
|---|---|---|
| `\begin{align}` / `\begin{equation}` alone | Not tokenized as math; treated as unknown env | Wrap the math in `$$...$$` display math instead |
| `\begin{theorem}` / `\begin{proof}` / `\begin{definition}` | Unknown env | Rewrite as `## Theorem N` + regular paragraph, or accept the blob |
| Custom `\newenvironment`s | Only patterns hard-coded in the parser are recognized | Inline the intended content |
| `\begin{list}{<non-numbered-label>}` | Only `\textbf{N.}` label triggers exercise anchor | Use `\begin{enumerate}` instead, or restructure |

## Solutions / answers

`\section*{פתרון תרגיל N}` / `\subsection*{פתרונות}` / `\textbf{פתרון שאלה N}` etc. are treated as solution headers — the following `enumerate` content gets attached as `fullSolution` to the preceding question blocks.

An answer key at the end of the file using `\textbf{שאלה N:}` per-answer will be parsed as separate exercises (each answer becomes its own exercise). If you want the answers to attach to the questions instead of standing alone, use `\section*{פתרון תרגיל N}` per answer.

---

## Recommended template

Minimal file that parses cleanly:

```latex
\documentclass[a4paper,12pt]{article}
\usepackage{amsmath, amssymb}
\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage{polyglossia}
\setmainlanguage{hebrew}
\setotherlanguage{english}
\newfontfamily\hebrewfont[Script=Hebrew]{David CLM}
\usepackage{enumitem}

\begin{document}

% ================= תרגיל 1 =================
\textbf{תרגיל 1 - חקירת פרבולה} \\

נתונות הפונקציות: $f(x) = -x^2 + 4x + 5$ ו-$g(x) = x + 1$.
בשרטוט מוצגים הגרפים של שתי הפונקציות.

\begin{enumerate}[label=\textbf{\alph*.}]
\item מצאו את שיעורי נקודות החיתוך $A$ ו-$B$.
\item מצאו את הקודקוד $C$ של הפרבולה.
\item מצאו את תחומי העלייה והירידה של $f(x)$.
\end{enumerate}

\selectlanguage{english}
\begin{tikzpicture}[scale=0.8]
\begin{axis}[
    axis lines=middle,
    xmin=-3, xmax=6, ymin=-2, ymax=11,
    ticks=none
]
\addplot[domain=-2:6, samples=100, thick] {-x^2 + 4*x + 5};
\fill (axis cs: -1, 0) circle (2pt) node[above left] {$A$};
\fill (axis cs: 4, 5) circle (2pt) node[above right] {$B$};
\fill (axis cs: 2, 9) circle (2pt) node[above] {$C$};
\end{axis}
\end{tikzpicture}
\selectlanguage{hebrew}

\newpage

% ================= תרגיל 2 =================
\textbf{תרגיל 2 - ...} \\
...

\end{document}
```

---

## Two-column PDF worksheets

Hebrew math worksheets often use `minipage` + `\begin{list}{\textbf{N.}}` for a two-column layout (question text left, diagram right). This is **directly supported** — the parser recurses into `minipage`, treats the `\begin{list}` as an exercise anchor, and processes the diagram column right after. Layout is lost but content is captured cleanly:

```latex
\begin{minipage}[t]{0.56\textwidth}
    \begin{list}{\textbf{1.}}{\setlength{\rightmargin}{0.5em}}
    \item Intro paragraph for exercise 1.
    \end{list}

    \begin{enumerate}[label=\textbf{\alph*.}]
    \item Sub-question a.
    \item Sub-question b.
    \end{enumerate}
\end{minipage}%
\hfill
\begin{minipage}[t]{0.40\textwidth}
    \selectlanguage{english}
    \begin{tikzpicture}
    \begin{axis}[...]
    \addplot[...] {...};
    \end{axis}
    \end{tikzpicture}
    \selectlanguage{hebrew}
\end{minipage}
```

---

## Compiling on Overleaf

Use **XeLaTeX** (Menu → Compiler → XeLaTeX) for Hebrew font support with `polyglossia`.

---

## When the deterministic parser fails

Every `.tex` import first runs the deterministic parser above. If the output is "unmeaningful" (< 10% of source characters captured, or total block content < 10 chars), the pipeline automatically falls back to an AI-based conversion per-exercise. The AI fallback is stochastic — hitting **Full Convert (LaTeX)** on the created lesson runs the whole pipeline again and can produce different results.

If your file consistently mis-parses:

1. Check the warnings on the exercise edit view — they name the specific offending line + environment.
2. Compare your source to the "Recommended template" above.
3. If a specific pattern of yours *should* parse but doesn't, open an issue with a minimal reproducing `.tex` snippet.
