# Lesson-Creation MVP — Validator

Bottom-up MVP of the lesson-generation pipeline. This slice is **just the validator**: given a lesson (either a v2 text file we generate later, or a DB dump we already have), report CRITICAL/HIGH/MEDIUM/LOW findings in the same style as `../lessonassesment/*.md`.

We build the validator first so we can regression-test it against 23 already-audited lessons — proving the rules catch the failure modes the human auditor caught, before we spend a dollar on LLM generation.

## Running

```
pnpm tsx lessoncreation/mvp/src/run-regression.ts
```

Reads every `../lessonassesment/dumps/*.txt` file, parses it, runs the validator, and prints a summary. Also writes a per-lesson report `.md` into `lessoncreation/mvp/generated-reports/` you can diff against the human report in `lessonassesment/`.

## Rules implemented (Phase 1 = CRITICAL)

| Rule | What it catches |
|---|---|
| `mcq-correct-option` | MCQ where the `correctOptionIds` option's text doesn't match the `solution` text (math-normalized). |
| `free-response-answer` | Free-response block with `acceptedAnswers: ["?"]` or empty. |
| `section-headers` | Question prompts missing the `**סעיף X:**` header (Hebrew letters or numbers). |
| `exercise-has-questions` | Exercise made entirely of `rich_text` / `svg` blocks with no MCQ or free-response. |

More rules land in Phase 2 (markdown-tables, svg-bidi, math-sanity, hint-discriminates).

## Regression result (2026-09-17)

Ran against all 23 audited dumps in `../lessonassesment/dumps/`. **Zero MISS cases** — every lesson the human auditor flagged with a CRITICAL is now covered by at least one of our rules.

Notes on over-counts vs the human report:
- Human found 88 CRITICALs total across the 23 lessons; we find 444.
- The gap is real, not a bug: many legacy lessons (`אחד ואפס`, `סדר פעולות חשבון`, `חוק הפילוג`, …) are pure `rich_text` / `svg` intros with **no questions at all**. The human didn't flag these because they were scoring text correctness. Our pipeline's job is to *replace* those shells with actual 10×4 exercises, so `exercise-has-questions` correctly fires on every empty exercise.
- Some lessons that DO have questions still show high over-counts (e.g., `מספרים מכוונים - חיבור וחיסור`: 118 vs 8). That's the human documenting a *sample* of a systemic failure; our automation reports every instance. This is the desired behavior for the pipeline — we don't want a "70-80% good" lesson to slip through because only 12% of its wrong-answer bugs were sampled.

## Layout

```
mvp/
├── README.md
└── src/
    ├── types.ts               canonical LessonModel + Finding
    ├── parse-dump.ts          === LESSON === dump → LessonModel
    ├── normalize.ts           math-answer normalization (self-contained)
    ├── rules/
    │   ├── mcq-correct-option.ts
    │   ├── free-response-answer.ts
    │   ├── section-headers.ts
    │   └── exercise-has-questions.ts
    ├── validate.ts            orchestrator
    ├── report.ts              findings → Hebrew .md
    └── run-regression.ts      CLI
```

MVP intentionally has no external deps — self-contained, runs via the repo's existing `tsx`.
