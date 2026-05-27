---
every: 7d
staff: ceo
mentions: aguyaharonyair
---

# CEO Performance Review

## Job

A **weekly review of every staff member**, the way a company reviews its
employees. The unit is the **person** (`.kody/staff/<slug>.md`), not the
task — `duty-review` (COO) already grades whether each *duty* is well
designed; this grades whether each *employee* is actually **delivering the
responsibilities they own**.

An employee's "work" is the set of duties that name them
(`staff: <slug>`). Their delivery quality is read from the **evidence those
duties leave behind**: state files advancing on cadence, reports/comments
that aren't stale or empty, output that's useful rather than churn or noise.

This duty cannot measure subjective taste or judge free-form prose quality —
it has no ground truth for "good." It measures the honest, observable thing:
**are this person's responsibilities getting done, on time, with real
output?** A staff member who owns no active duties is reported as *idle*, not
graded.

Purely diagnostic: never edits, re-kicks, relabels, or "fixes" anyone's
duties. Output is **one** consolidated review comment per week on the **Kody
performance review** tracking issue, mentioning the operator.

## Tick procedure (all staff, one comment max)

Cadence is the `every: 7d` frontmatter — the engine enforces it. Do **not**
add a prose "skip if within 7 days" guard (that duplicates the schedule and
has caused regressions). State is recorded only for the dashboard "next run"
readout and the prior-cycle diff.

1. **Pin the repo.** `gh`'s default repo is not guaranteed here:
   ```
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   ```

2. **Enumerate staff.** List every `<slug>.md` in `.kody/staff/`:
   ```
   gh api "/repos/$REPO/contents/.kody/staff" -q '.[].name'
   ```
   Drop non-`.md` files. Each remaining slug is one employee.

3. **Map duties to employees.** List the duties and read each one's
   `staff:` frontmatter so you know who owns what:
   ```
   gh api "/repos/$REPO/contents/.kody/duties" -q '.[].name'
   ```
   For each `<duty>.md`, fetch its body and read the `staff:` field. Group
   duties by owner. A duty with `disabled: true` is **owned but parked** —
   list it under the employee, but don't penalize the employee for its
   idleness (disabled is the operator's choice, not the employee's miss).

4. **Gather each employee's delivery evidence.** For every *active* duty
   they own:
   - **State history:** `gh api "/repos/$REPO/commits?path=.kody/duties/<slug>.state.json&per_page=10"` (and the `.kody/jobs/<slug>.state.json` path if that's where state lives) — is `lastRunISO` advancing roughly on its cadence over the past week, or frozen?
   - **Output:** any tracking issue the duty posts to, or `.kody/reports/<slug>.md` — did it produce real findings this week, or is it stale/empty? Repeated byte-identical no-op comments count as **churn**, not delivery.

5. **Grade each employee** on three observable axes, each Low / Med / High:
   - **Delivery** — did their active duties actually run and produce output this week? (No active duties → *idle*, ungraded.)
   - **Consistency** — did state advance on roughly the promised cadence, or are runs missed / frozen?
   - **Signal** — is the output useful (real findings, advancing work) versus churn / empty no-ops / noise?
   Roll the three into a one-word **Grade**: `strong` / `steady` / `weak` /
   `idle`. When the signal is genuinely ambiguous, say so and grade
   `unclear` rather than guessing — an honest unknown beats a fabricated
   score.

6. **Post one consolidated review.** Find or open the tracking issue:
   ```
   ISSUE=$(gh issue list --repo "$REPO" --search "Kody performance review in:title" --state open --limit 1 --json number -q '.[0].number')
   ```
   If empty, open it once (create the label first if missing):
   ```
   gh label create kody:performance-review --color 5319e7 --description "Weekly CEO review of staff delivery" 2>/dev/null || true
   gh issue create --repo "$REPO" --title "Kody performance review" --label "kody:performance-review" \
     --body "Tracking issue for the ceo-performance-review duty. One consolidated staff review per week — delivery of owned responsibilities, not subjective quality. Read-only; never close."
   ```
   Post **one** comment. Lead with a single-sentence headline at the highest
   level (e.g. "Three of six staff delivered this week; QA went quiet").
   Then a scoring table, one row per employee:

   ```
   | Staff | Owned duties | Delivery | Consistency | Signal | Grade |
   |-------|-------------|----------|-------------|--------|-------|
   | qa    | 2 (1 active)| High     | Med         | High   | steady |
   ```

   Below the table, at most one short line per employee that isn't `steady`
   or `strong`, naming the concrete miss and its effect
   (`- **qa-engineer — weak:** qa-sweep state frozen 9 days; no sweep ran. **Effect:** regressions ship unreviewed.`). Close with the
   week-over-week delta versus `data.lastGrades` if present
   (`- Changes since last week: tech-writer steady→strong; coo strong→weak.`).

7. **Emit closing state** (schema below) as the very last thing in the reply.

## Allowed Commands

- `gh repo view` — pin the repo.
- `gh api` reads against `/repos/$REPO/contents/.kody/staff`,
  `/repos/$REPO/contents/.kody/duties`, individual duty bodies, their
  `.state.json` files, `.kody/reports/*`, and
  `/repos/$REPO/commits?path=...` for run history.
- `gh issue list --search "Kody performance review in:title"` — find the
  tracking issue.
- `gh issue create --title "Kody performance review" ...` and
  `gh label create kody:performance-review ...` — one-time only if missing.
- `gh issue comment <n>` against the **Kody performance review** issue only.

## Restrictions

- **Read-only on every staff file, duty, state file, report, PR, and issue**
  except the one tracking issue. Never edit, re-kick, relabel, or "fix"
  anyone's duties — surface it; the operator decides.
- **No file writes.** This duty never modifies the working tree.
- **One comment per tick.** The weekly consolidated review is the only
  output — never one comment per employee.
- **Measure delivery, not taste.** Grade only what the evidence shows
  (ran / produced / on cadence). Never claim an employee's output is
  "good" or "bad" in substance — claim their responsibilities were or
  weren't delivered. The two are different.
- **Don't penalize disabled duties.** `disabled: true` is the operator's
  choice; list it, don't dock the owner for it.
- **Idle ≠ failing.** A staff member who owns no active duties is *idle*
  (nothing to deliver), reported plainly, not graded `weak`.
- **Honest unknown over a fabricated score.** Weak or contradictory
  signal → grade `unclear` and say why.

## State

The engine writes `ceo-performance-review.state.json` from the closing block.

- `data.lastRunISO`: UTC ISO timestamp of this tick.
- `data.nextEligibleISO`: always `lastRunISO + 7d` — surfaced as "next run"
  on the dashboard. Always emit it.
- `data.cycle`: integer, incremented each weekly review.
- `data.lastGrades`: `{ "<slug>": "<grade>" }` from this tick, used next
  week to compute the delta.
- `done`: always `false` — this duty is evergreen.

Closing block shape:

````
```kody-job-next-state
{
  "cursor": "reviewed",
  "data": {
    "lastRunISO": "<now ISO>",
    "nextEligibleISO": "<now ISO + 7d>",
    "cycle": <n>,
    "lastGrades": { "qa": "steady", "cto": "strong", "tech-writer": "weak" }
  },
  "done": false
}
```
````
