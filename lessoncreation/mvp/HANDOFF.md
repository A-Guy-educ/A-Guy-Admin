# Lesson Generation Pipeline — Handoff

**Branch**: `feat/lessoncreation-pipeline` (pushed to remote, PR #483 closed to avoid CI). Do not merge to `dev` yet — CI/typecheck hasn't been resolved.

**Last state**: 3 commits deep. Pedagogical critic just landed. Pipeline produces grade-10 quality lessons at ~$1-3 each, ~7-10 min per lesson.

## Architecture — 6 stages, all on `gemini-3.1-pro-preview`

Model config in `src/models.ts`.

```
Planner       → LessonSkeleton JSON (10 exercises × 4 sections)
    ↓
2 critics in parallel:
    ├─ Structural Critic (9 named rules)
    └─ Pedagogical Critic (teacher role, no rules)
    ↓  combined findings
Reviser       → surgical patch flagged exercises; unchanged ones byte-identical
    ↓  (up to 3 iterations of critic→reviser)
Writer        → v2 text with {{SKETCH BEGIN}}...{{SKETCH END}} fences
    ↓
Materializer  → per-sketch parallel calls; DSL for geometry, SVG for pictorial
    ↓
Reader Critic → per-exercise Gemini call as a student; auto-fix loop with
                chunked patches (max 3 per parallel writer call);
                splice back into full text; max 2 iterations
```

## Recent quality wins (in order)

1. **Warm opening rule** in planner + critic — first 2-3 exercises are easy applications, not definitions
2. **Materializer fixes**: black points, single-letter names (no P1/P2), `מיקום תווית` vs `תווית` disambiguation
3. **Reader critic (stage 6)** — reads final rendered text as a student; catches sketch-mismatch / content-issue / plan-fidelity
4. **Chunked writer regen** — max 3 exercises per parallel call (was 7 at a time → truncated DSL)
5. **Splice fix** — `extractExerciseText` finds next-existing header ≥ N+1, not exactly N+1 (fixes skip-number patch text)
6. **Pro model upgrade** — was Flash for all stages; going Pro cut reader-critic iter 1 findings from 10 CRIT → 1 CRIT
7. **Pedagogical critic** — no explicit rules, teacher role. Caught the "SSS by name in E1 before intro" bug (structural critic missed it because expectedDiscovery didn't flag it)

## Latest smoke test — משולשים חופפים

- Skeleton HALT after 3 iter (3 pedagogical findings left, structural clean)
- Writer PARSE-CLEAN, 10/10 sketches
- **Reader critic iter 1: 0 CRITICAL, 0 HIGH** — best result on this lesson
- Wall time: 546s (~9 min)
- File: `generated-lessons/משולשים-חופפים.txt`
- Verdicts persisted: `generated-verdicts/{משולשים-חופפים.iter{1,2,3}.{structural,pedagogical}.json,reader-iter1.json}`

## Known issues / open questions

1. **Some remaining terminology issues** — pedagogical critic flagged 3 HIGH on iter 3, reviser hit max iterations. Concept is introduced (section ב) but formal theorem name isn't spelled out before it's tested (section ג). Reviser could benefit from more iterations OR a "commit to the fix" instruction.
2. **Writer regen with feedback still sometimes drops details** — regenerating an exercise with reader-critic feedback occasionally produces sketches missing markings that were fine before. Chunking (max 3/call) mitigates but doesn't fully eliminate.
3. **Function graphs not supported** — writer emits SVG, but Gemini can't do accurate coordinate math for function plots. Requires the axis DSL boss's team is prototyping (in `נסיון פונקציות.txt` from earlier drop).
4. **Boss's new structured geometry format** (from `geometry_drawing_structure_prompt.txt`) not integrated — YAML-ish nested format with CIRCLES / ANGLES / CONSTRAINTS. Deferred as post-MVP.
5. **Prompt bloat** — planner prompt is ~400+ lines. Rules are additive, no consolidation yet. Watch for quality regression from dilution.
6. **170 boss lessons** (in `C:\Users\kotz9\OneDrive\Desktop\gene\שעורי לימוד - חטיבה-20260922T062015Z-1-001\`) not yet triaged. 127 are ≥10 sections complete, 42 are partial. Planned path 3: format B → A converter + regenerate the 99 partials. Not started.

## How to run

Env: `GEMINI_API_KEY` in `.env`. Uses `@google/generative-ai` v0.24.1 (already installed).

```bash
# Full pipeline on one lesson (edit TARGET in the file)
pnpm tsx --env-file=.env lessoncreation/mvp/src/run-single-congruent.ts

# Just E1-E3 for opening iteration (~90s vs ~500s)
OPENING_LESSON=pythagoras pnpm tsx --env-file=.env lessoncreation/mvp/src/run-opening.ts
# valid keys: pythagoras, factoring, congruent, trig

# Full 3-lesson variety batch
pnpm tsx --env-file=.env lessoncreation/mvp/src/run-samples.ts

# Full 10-lesson grade-10 batch (~50 min, ~$10)
pnpm tsx --env-file=.env lessoncreation/mvp/src/run-batch.ts
```

Outputs go to `generated-lessons/`, `generated-skeletons/`, `generated-verdicts/`, `generated-openings/`.

## Cost check

Today: ~5 ILS spent (per Google Console). Pipeline is cheap enough that batches of 10-40 lessons are viable overnight.

## Suggested next moves (roughly priority-ordered)

1. **Rerun trig + factoring + pythagoras with dual-critic pipeline** — verify pedagogical critic helps across topics, not just congruent triangles
2. **Add "commit to the fix" instruction to reviser** — when reader/pedagogical critic flags something multiple iterations, reviser should more aggressively rewrite (not just soften)
3. **Import a generated lesson into admin** — verify end-to-end rendering. Parser Claude's fixes for shared-geometry + inline SVG shipped; label field fix done on our side. Should render cleanly now.
4. **170-lesson triage** — write Format B → Format A converter, batch-import the 127 complete lessons, then regenerate the ~40 non-function partials
5. **Prompt audit** — consolidate planner rules if bloat becomes a quality issue

## Files added this session (not in the earlier PR)

- `src/critic/pedagogical-prompt.ts`
- `src/critic/pedagogical-critic.ts`
- `src/reader-critic/{schema.ts, prompt.ts, read-critic.ts, splice.ts}`
- `src/models.ts` (central model config)
- `src/run-opening.ts` (E1-E3 CLI)
- `src/run-single-congruent.ts` (full pipeline smoke test)
- Modified: `pipeline.ts` (dual critics + reader critic loop), `writer/{prompt.ts, write-lesson.ts}` (feedbackPerExercise + onlyExercises), `materializer/prompt.ts` (label fix), `critic/prompt.ts` (warm opening + failure examples)
