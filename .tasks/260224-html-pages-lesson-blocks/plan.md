# Plan: HTML Content Pages & Lesson Blocks

## Summary

Two features are needed to support rich HTML content within lessons:

1. **ContentPages collection** — A new, generic Payload collection storing reusable HTML content pages (using the Quill WYSIWYG editor).
2. **Lesson Blocks** — A polymorphic ordered list on the Lesson collection that serves as the strict playlist for the lesson. It can contain `exerciseRef` blocks and `contentPageRef` blocks.

### Current State
- Lessons implicitly fetch exercises that have a matching `lesson` relationship, ordered by an `order` field on the exercise.
- There is no concept of "lesson blocks".

### Architecture Decisions
- **Generic ContentPages**: ContentPages will NOT be tied to a specific lesson in the database. They act as a shared pool of reusable content (like Media).
- **Strict Lesson `blocks` field**: The `blocks` array on a Lesson is the SOLE source of truth for what content belongs to that lesson and in what order. 
- **NO Backward Compatibility / Deprecation**: The `order` field on `Exercises` will be removed. All lessons MUST use the `blocks` array.
- **Slug uniqueness**: ContentPages will have globally unique slugs.

---

## Step 1: Create ContentPages Collection (Generic)

**Time estimate**: 20 minutes

**Files to Touch**:
- `src/server/payload/collections/ContentPages/index.ts` (NEW)
- `src/server/payload/collections/ContentPages/hooks.ts` (NEW — slug generation)
- `src/payload.config.ts` (MODIFIED — add to collections array)

**Exact Behavior**:
- New collection `content-pages` with fields:
  - `title` (text, required)
  - `slug` (text, unique, indexed) — URL-friendly identifier, globally unique.
  - `htmlContent` (textarea field, required) — Uses `QuillField` admin component.
  - `status` (select: draft/published, default: draft)
  - `isActive` (checkbox, default: true)
  - `tenantField`, `createdByField`
  - *(Notice: No `lesson` relationship field. It is a standalone, reusable resource.)*
- Access control: adminOnly for CUD, published-or-authenticated for read.

---

## Step 2: Extract Shared HTML Validation Utility

**Time estimate**: 15 minutes

**Files to Touch**:
- `src/server/payload/fields/htmlValidation.ts` (NEW)
- `src/server/payload/blocks/HtmlBlock/config.ts` (MODIFIED)
- `src/server/payload/collections/ContentPages/index.ts` (MODIFIED)

**Exact Behavior**:
- Extract the `validate` function body from `HtmlBlock/config.ts` into a shared utility `validateHtmlContent`.
- Both `HtmlBlock` and `ContentPages` use this shared validator.

---

## Step 3: Add `blocks` Field to Lessons & Remove `order` from Exercises

**Time estimate**: 20 minutes

**Files to Touch**:
- `src/server/payload/blocks/LessonBlocks/ExerciseRefBlock.ts` (NEW)
- `src/server/payload/blocks/LessonBlocks/ContentPageRefBlock.ts` (NEW)
- `src/server/payload/collections/Lessons.ts` (MODIFIED — add `blocks` field)
- `src/server/payload/collections/Exercises/index.ts` (MODIFIED — remove `order` field)

**Exact Behavior**:
- **Blocks**: Standard Payload blocks referencing their respective collections (`exercises` and `content-pages`).
- **Lessons collection**: Add `blocks` field (required: true, minRows: 1). This is the strict playlist.
- **Exercises collection**: **DELETE the `order` field.**

---

## Step 4: Update Query Functions (Strict Blocks Mode)

**Time estimate**: 20 minutes

**Files to Touch**:
- `src/server/repos/queries/contentPages.ts` (NEW)
- `src/server/repos/queries/lessonBlocks.ts` (NEW)
- `src/server/repos/queries/exercises.ts` (MODIFIED - remove obsolete queries)

**Exact Behavior**:
- `queryLessonBlocks({ lessonId })`:
  1. Fetch the lesson at depth: 0.
  2. Batch-resolve the `blocks` array (fetch all referenced exercises and content pages).
  3. Return ordered `LessonBlock[]`.
- `queryContentPageBySlug({ slug })`: Fetches a generic content page by its global slug.
- Remove `queryExercisesByLesson` as it no longer relies on the `order` field.

---

## Step 5: Create ContentPage Renderer Component

**Time estimate**: 15 minutes

**Files to Touch**:
- `src/ui/web/ContentPageRenderer/index.tsx` (NEW)

**Exact Behavior**:
- Client component rendering HTML safely via `SafeHtml`.

---

## Step 6: Generalize Pager → LessonPager

**Time estimate**: 30 minutes

**Files to Touch**:
- `src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/_components/LessonPager/*` (NEW/MODIFIED)
- `src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/page.tsx` (MODIFIED)

**Exact Behavior**:
- Hook and component accept `blocks: LessonBlock[]`.
- Progress and pagination based entirely on the blocks array.
- URL syncing uses `/exercises/{slug}` and `/content/{slug}`.

---

## Step 7: Add Content Page Route

**Time estimate**: 15 minutes

**Files to Touch**:
- `src/app/(frontend)/courses/[courseSlug]/chapters/[chapterSlug]/lessons/[lessonSlug]/content/[pageSlug]/page.tsx` (NEW)

**Exact Behavior**:
- Route renders the full `LessonPager`.
- Security Check: Even though the ContentPage is generic, this route must verify that the requested `pageSlug` actually exists within the specific Lesson's `blocks` array to prevent users from rendering random content pages inside a lesson they don't belong to.

---

## Step 8: Enhanced Admin Editor

**Time estimate**: 20 minutes

**Files to Touch**:
- `src/ui/admin/ContentPageEditor/index.tsx` (NEW)

**Exact Behavior**:
- Full-page WYSIWYG editor for content pages with live preview.

---

## Step 9: Tests & Cleanup

**Time estimate**: 20 minutes

**Files to Touch**:
- `tests/int/lesson-blocks-e2e.int.spec.ts` (NEW)
- Fix broken tests related to the removed `order` field on exercises.
