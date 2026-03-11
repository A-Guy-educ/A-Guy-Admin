# Course Page Redesign — Implementation Plan

## Reference

Figma: https://beaver-snack-74767221.figma.site

This plan describes EXACTLY what the Figma design looks like and what each component should render. This is a **visual-only** redesign — no backend, API, routing, or business logic changes.

---

## 1. Overall Page Layout

- Background: clean light gray (`bg-background` — no gradients, no glassmorphism)
- Content centered, max-width container (`max-w-5xl mx-auto`)
- Vertical flow top to bottom: Tabs → Exam Reminder → Course Title → Lesson Cards → Divider → Footer Buttons
- RTL layout (Hebrew)

---

## 2. Tabs (`CourseTabs/index.tsx`)

**Current PR state**: Individual pill buttons with gap between them — close but not grouped.

**Figma spec**: 4 tabs grouped inside a single rounded container (like a segmented control).

### Required changes:

```
Outer container:
- className="bg-muted/50 p-1 rounded-full flex items-center justify-center gap-0 max-w-md mx-auto"
- (a single pill-shaped wrapper that groups all 4 tabs)

Each tab button:
- className="flex-1 px-6 py-2 text-sm rounded-full transition-all"
- Active: "bg-card text-primary font-bold shadow-sm"
- Inactive: "text-muted-foreground hover:text-foreground"
- NO individual borders on tabs — the outer container provides the grouping

Tab order (RTL): למידה | תרגול | בחינות | שאלות
```

**File**: `src/app/(frontend)/courses/[courseSlug]/_components/CourseTabs/index.tsx`

---

## 3. Exam Reminder Badge (`ExamReminderBubble/index.tsx`)

**Current PR state**: Already a centered pill badge — mostly correct.

**Figma spec**: Dark maroon/wine-red solid pill badge, centered, white bold text.

### Required changes:

```
- className="bg-[#7C1D2A] text-white text-sm font-bold px-6 py-2 rounded-full"
- Centered with flex justify-center
- Text: "עוד {days} ימים לבחינה"
- No sparkles icon, no chat-bubble shape — just a clean pill
```

The current PR is close but uses `bg-primary` which might not be the correct dark maroon. Verify the primary color matches `#7C1D2A` (dark wine red). If primary IS that color, keep `bg-primary`. If not, use the explicit hex.

**File**: `src/app/(frontend)/courses/[courseSlug]/_components/ExamReminderBubble/index.tsx`

---

## 4. Course Title Area (`CoursePageContent/index.tsx`)

**Current PR state**: Has gradient background, title + grade label.

**Figma spec**: Clean white/light background (NO gradient). Centered layout.

### Required changes:

```
Title area wrapper:
- className="w-full py-6 px-6" (NO bg-gradient-to-b, just clean background)

Inside (centered):
1. ExamReminderBubble (if applicable)
2. Course title: className="text-3xl md:text-4xl font-black text-foreground mt-4 text-center"
   - Shows course.title (e.g., "כיתה י' - 4 יח"ל")
3. NO grade/courseLabel subtitle — the Figma only shows the course title, not a separate grade line

Remove: The gradient classes (from-background to-muted/30)
Remove: The grade label (<p> with tracking-[0.3em]) — NOT in the Figma
```

**File**: `src/app/(frontend)/courses/[courseSlug]/_components/CoursePageContent/index.tsx`

---

## 5. Lesson Cards (`CourseLessonCard/index.tsx`)

**Current PR state**: Cards are close but need layout direction fix for RTL.

**Figma spec**: Horizontal card, border is thin blue/primary, progress circle on the LEFT side (in RTL that means start side), text on the RIGHT side (end side).

### Required changes:

```
Card container:
- className="bg-card rounded-2xl p-5 shadow-sm border border-primary/30 flex items-center justify-between transition-all cursor-pointer active:scale-[0.98]"
- This is already close in the PR

Layout inside the card (RTL):
- Progress circle: on the START side (left in RTL) — use "order-first" or place it first in DOM with flex-row-reverse
- Text block: on the END side (right in RTL)
  - Lesson number: small uppercase label ("שיעור 1") — text-[10px] font-bold text-muted-foreground uppercase tracking-wide
  - Lesson title: text-lg font-bold text-card-foreground
  - Status text: text-xs text-muted-foreground, with Clock icon if not started

Progress circle:
- Shows percentage text INSIDE (100%, 45%, 0%)
- When progress > 0: circle is filled proportionally with primary color
- When progress === 0: show "0%" text inside, gray/muted stroke
- Do NOT show Play icon overlapping the circle — the Figma shows just the percentage text
- Remove the Play icon overlay for progress === 0

Circle colors from Figma:
- 100%: solid blue/primary ring
- 45%: partial blue/primary ring
- 0%: gray/muted ring with "0%" text
```

### Fix the Play icon overlap:

The current code renders both a `<text>` element inside ProgressCircle AND a Play icon absolutely positioned on top when progress === 0. The Figma shows ONLY the percentage text. Remove the Play icon block entirely.

**File**: `src/app/(frontend)/courses/[courseSlug]/_components/CourseLessonCard/index.tsx`

---

## 6. Lesson Cards Grid (`LearnTab/index.tsx`)

**Current state**: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` — this is correct per the Figma (3 cards in a row on desktop).

**No changes needed** for LearnTab.

---

## 7. Footer Buttons (`CoursePageContent/index.tsx`)

**Current PR state**: 3-column grid with icons — close but needs color fixes.

**Figma spec**: 3 buttons in a horizontal row, separated by a subtle divider line above.

### Required changes:

```
Divider: mt-16 pt-8 border-t border-border (already in PR — correct)

Button layout: grid grid-cols-1 md:grid-cols-3 gap-4 (already in PR — correct)

Button 1 (right in RTL): "סטטיסטיקה וביצועים"
- Outlined style: bg-card border border-border text-foreground rounded-full
- Icon: BarChart3 (already correct)
- hover:bg-muted/50

Button 2 (center): "בחינה הקרובה"
- Solid dark maroon: bg-[#7C1D2A] text-white rounded-full shadow-lg
- Icon: GraduationCap (already correct)
- hover:opacity-90
- NOTE: Current PR uses bg-primary which may or may not match. If primary is not #7C1D2A, use explicit color.

Button 3 (left in RTL): "מעבר לבגרות"
- Outlined style: bg-card border border-border text-foreground rounded-full
- Icon: Sparkles (already correct)
- hover:bg-muted/50
```

The translation keys (`statsAndPerformance`, `upcomingExam`, `bagrutTransition`) are already added — correct.

**File**: `src/app/(frontend)/courses/[courseSlug]/_components/CoursePageContent/index.tsx`

---

## 8. Summary of Changes per File

| File | What to change |
|------|---------------|
| `CourseTabs/index.tsx` | Wrap tabs in a grouped pill container instead of individual pills |
| `ExamReminderBubble/index.tsx` | Verify color is dark maroon (#7C1D2A), remove any leftover sparkles/chat-bubble styling |
| `CoursePageContent/index.tsx` | Remove gradient background, remove grade label line, fix center button color to dark maroon |
| `CourseLessonCard/index.tsx` | Remove Play icon overlay for 0% progress (keep only percentage text), verify RTL layout has circle on start side |
| `LearnTab/index.tsx` | No changes needed |
| `en.json` / `he.json` | Already have correct translation keys — no changes needed |

---

## 9. What NOT to Change

- No backend/API changes
- No new routes
- No new collections
- No new providers or context
- No new CSS files or global styles
- No new dependencies
- Keep all existing functionality working
- Keep existing responsive behavior (grid-cols-1 on mobile, grid-cols-3 on desktop)

---

## 10. Acceptance Criteria

1. Tabs appear as a grouped segmented control (single rounded container)
2. Exam reminder is a dark maroon pill badge, centered
3. Course title is centered, large bold text, NO gradient background, NO grade subtitle
4. Lesson cards show percentage inside the progress circle, NO play icon overlay
5. Footer has 3 buttons: 2 outlined + 1 solid dark maroon center button
6. No TypeScript errors (`pnpm typecheck`)
7. No lint errors (`pnpm lint`)
8. Existing integration tests pass
9. RTL layout is correct
