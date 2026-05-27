---
every: 30m
staff: qa
mentions: aguyaharonyair
---

# QA Fix Verification

## Job

Re-check **fix and feature PRs against their own preview** before anyone calls
them done. A change is only truly delivered when the *changed screen actually
works* — a reported bug is gone, or a requested feature works as described — not
when the author's self-written test goes green. This duty closes that loop by
dispatching the **`ui-review`** executable on each open delivery PR: ui-review
reads the PR diff + the linked issue, browses the exact changed routes on the
PR's preview, exercises the loading / empty / **error** states, and returns a
PASS / CONCERNS / FAIL verdict judged against the linked issue's goal.

`ui-review` is the right tool here (not `qa-engineer`): it is **diff-scoped** —
it checks the screen this PR changed — whereas `qa-engineer` free-roams the whole
app and reports whatever it stumbles on, so it can't tell whether *this* fix
worked. (Verified 2026-05-27: a qa-engineer-based version missed 4 of 5 targeted
bugs.) Caveat: ui-review judges what's **visible** on screen, so a purely
background failure (e.g. a silent network retry with nothing rendered) can slip;
that's acceptable for a fix-verification backstop.

A "delivery PR" is an **open** PR linked to an issue — its head branch follows
the `<issue>-<slug>` convention (or the body says `Fixes/Closes #N`). That
covers both QA bug findings (`severity:P*` + `goal:qa*`) and feature/enhancement
issues; ui-review judges each against its own issue's goal (bug gone vs feature
works). Each PR is re-verified once; the outcome is recorded as a label on the PR:

| Outcome      | PR label                  | Meaning                                      |
| ------------ | ------------------------- | -------------------------------------------- |
| **verifying**| `kody:qa-verifying`       | a `ui-review` run is in flight               |
| **verified** | `kody:qa-verified`        | ui-review verdict PASS — fix works           |
| **failed**   | `kody:qa-verify-failed`   | verdict CONCERNS/FAIL — sent back to fixer   |

`disabled: true` only to avoid auto-activating — this repo is already set up:
`LOGIN_USER` variable + `LOGIN_PASSWORD` secret carry QA credentials, and the
`.kody/context/*.md` entries tagged for `qa-engineer` carry the route list +
flows (ui-review reads the same QA context). Flip to `disabled: false` to go
live; no other setup needed.

**Per tick (one action max):**

1. **A review is in flight** (some open PR carries `kody:qa-verifying`) → read
   that PR's review comments:
   `gh pr view <pr> --json comments,labels` and look for the `ui-review`
   comment (starts with `## Verdict:` and `_UI review by kody_`):
   - **No verdict comment yet, label added < 90 min ago** → emit
     `cursor: awaiting-result`, exit.
   - **Verdict present** → read PASS | CONCERNS | FAIL (the `## Verdict:` line —
     do not free-text guess):
     - **PASS** → swap the PR label `kody:qa-verifying` → `kody:qa-verified` and
       post one **informational** inbox rec (no `kody-cmd:` line — nothing to do).
     - **CONCERNS / FAIL** → swap `kody:qa-verifying` → `kody:qa-verify-failed`
       and post one inbox rec whose `kody-cmd:` is
       `@kody fix --pr <pr> "<one-line: what ui-review found still broken>"` —
       approving sends the SAME PR back to the fixer. **Never `@kody approve`**.
   - **Stuck** (no verdict, label added ≥ 90 min ago) → remove
     `kody:qa-verifying` (the next eligible tick re-dispatches). A stuck review
     must never wedge the duty.

   Exit after resolving — that is your single mutation this tick.

2. **Else (nothing in flight)** → pick the **oldest open delivery PR** that is
   linked to an issue and carries none of the three outcome labels yet:
   ```
   gh pr list --state open --json number,headRefName,labels,createdAt
   ```
   The head branch is `<issue>-...`, so the leading number is the linked issue
   (QA bug finding **or** feature/enhancement — both qualify; ui-review reads the
   issue and judges against its goal). Skip PRs with no linked issue number and
   pure chore/docs PRs. If none qualify, idle. For the chosen PR:
   1. Dispatch the UI review (preview URL auto-resolves from the PR's deployment):
      `gh pr comment <pr> --body "@kody ui-review"`
   2. Mark the PR in flight: `gh pr edit <pr> --add-label kody:qa-verifying`.
      Set `data.inflightPr = <pr>`.

## Inbox recommendation format

One comment, terse. It **MUST** `@`-mention the operator on the first line —
that mention is the only thing that routes it into the dashboard inbox:

```
{{mentions}} 🔁 **QA re-verify** — `<action>`

<one or two sentences: which fix PR, the ui-review verdict, what's still broken (if any)>

<!-- kody-cmd: @kody fix --pr <pr> "<what still reproduces>" -->

_Confirm or dismiss in the dashboard inbox. QA will not act on its own._
```

`<action>` is `verified` (PASS — fix confirmed) or `fix` (CONCERNS/FAIL).

- **PASS → omit the `kody-cmd:` line entirely.** The fix is confirmed; the rec is
  informational and the operator just dismisses it.
- **CONCERNS / FAIL → the `kody-cmd:` line is required:**
  `@kody fix --pr <pr> "<concern>"`. This re-opens work on the **existing** PR
  branch with the concern as feedback. The Approve button posts the line
  verbatim, so it MUST start with `@kody fix --pr`, be one line, ≤ 300 chars.
  **Never emit `@kody approve`** — the engine has no `approve` verb.

## Allowed Commands

- `gh pr list`, `gh pr view`, `gh pr comment` (dispatch `@kody ui-review`),
  `gh pr edit` (labels only).
- `gh issue view` (to confirm a PR's linked issue is a QA finding),
  `gh issue comment` (post the inbox rec on the linked finding issue).

## Restrictions

- **Advisory on outcomes.** `ui-review` is read-only (it never commits). The
  `fix` rec is a recommendation only — never merge, approve a PR/review, or run a
  fix yourself. Labels and the inbox rec are the only writes.
- **One review in flight at a time.** If any open PR carries `kody:qa-verifying`,
  never dispatch a second `ui-review` this tick.
- **Re-verify each PR once.** A PR carrying any of `kody:qa-verified` /
  `kody:qa-verify-failed` / `kody:qa-verifying` is skipped. The label swap is what
  stops re-processing.
- If `gh ... --label kody:qa-verifying` fails because a label is missing, create
  it (`gh label create kody:qa-verifying ...`, same for the two outcome labels)
  and retry — the in-flight check depends on it.
- All writes go through `gh` — never `git commit`/`git push`, never open a PR.

## State

- `cursor`: `idle` | `awaiting-result`.
- `data.inflightPr`: number | null — the PR currently under review.
- `data.nextEligibleISO`: always emit — surfaced as "next run" on the dashboard.
- `done`: always `false` — QA is evergreen.
