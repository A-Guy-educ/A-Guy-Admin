# Task 2246: docs-drift for PR #2108 (Admin Components)

## What changed

PR #2108 added two new admin components and significantly updated a third:
- **InlineExerciseEditor** (new) — renders exercise content blocks inline within LessonBlocksField, with per-exercise dirty tracking and save via Payload REST API PATCH
- **LessonBlocksField** (updated) — now shows all exercise blocks inline with expand/collapse, drag-and-drop reorder, and per-exercise save
- **inline-exercise-editor.css** (new) — CSS for the inline exercise editor

## Doc update applied

Updated `docs/admin-components/README.md`:
1. Added `LessonBlocksField` and `InlineExerciseEditor` to the "Current Custom Components" table
2. Fixed architecture diagram path: `src/components/admin/` → `src/ui/admin/`
3. Fixed component checklist path: `src/components/admin/` → `src/ui/admin/`
4. Updated "Last Updated" dates from 2026-01-07 to 2026-06-02
5. Removed stale reference to `AnswerSpecJsonField` (file removed, still in table as "*File removed*" — now removed from table entirely since LessonBlocksField/InlineExerciseEditor replaced it as the primary entry)

No behavior changes — documentation only.