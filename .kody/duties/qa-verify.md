---
every: 30m
staff: qa
mentions: aguyaharonyair
---

# QA Fix Verification

## Job

Re-check **fix PRs against their own preview** before anyone calls the bug done.
A QA finding is only truly resolved when the *same steps that found it* pass on
the *fixed* build — not when the fixer's self-written test goes green. This duty
closes that loop: for each open fix PR that addresses a QA finding, it replays
the finding's original repro steps on the PR's **preview deployment** and records
PASS (genuinely fixed) or FAIL (still broken → send back to the fixer).

Browsing is delegated to the `qa-engineer` executable (this duty runs no browser
itself); the duty opens a tracking issue, dispatches the run **against the PR's
preview URL** (`--url`), and reads the verdict back on a later tick.
**One run in flight at a time** — this bounds browser cost.

A "fix PR for a QA finding" is an **open** PR whose linked issue carries a
`severity:P*` + `goal:qa*` label (the per-finding tickets that `qa-goal` opens).
The PR is re-verified exactly once; the outcome is recorded as a label on the PR:

| Outcome      | PR label                  | Meaning                                   |
| ------------ | ------------------------- | ----------------------------------------- |
| **verifying**| `kody:qa-verifying`       | a re-check run is in flight               |
| **verified** | `kody:qa-verified`        | repro steps PASS on the preview — fix real |
| **failed**   | `kody:qa-verify-failed`   | bug still reproduces — sent back to fixer |

`disabled: true` only to avoid auto-activating — this repo is already set up:
`LOGIN_USER` variable + `LOGIN_PASSWORD` secret carry QA credentials, and the
`.kody/context/*.md` entries tagged for `qa-engineer` carry the route list +
flows. Flip to `disabled: false` to go live; no other setup needed.

**Per tick (one action max):**

1. **A re-check is in flight** (an open issue labelled `kody:qa-verify` exists) →
   read its tracking issue: `gh issue view <n> --json state,title,comments,labels,createdAt`.
   - **No `qa-engineer` report yet, issue < 2h old** → emit `cursor: awaiting-result`, exit.
   - **Report present** → read the verdict (`QA [PASS|CONCERNS|FAIL]` title or
     `kody:qa-report` label — do not free-text guess). Let `<pr>` be the PR under
     test (recorded in `data.inflightPr`):
     - **PASS** → the bug is genuinely gone. Swap the PR label
       `kody:qa-verifying` → `kody:qa-verified`, close the tracking issue, and
       post one **informational** inbox rec (no `kody-cmd:` line — nothing to do,
       the operator just dismisses).
     - **CONCERNS / FAIL** → the bug still reproduces on the fixed build. Swap the
       PR label `kody:qa-verifying` → `kody:qa-verify-failed`, **leave the
       tracking issue open**, and post one inbox rec whose `kody-cmd:` is
       `@kody fix --pr <pr> "<one-line: what still reproduces>"` — approving sends
       the SAME PR back to the fixer with the concern. **Never `@kody approve`**.
   - **Stuck** (no report, issue ≥ 2h old) → comment the stall, close the tracking
     issue, remove `kody:qa-verifying` from the PR (the next eligible tick re-runs).
     A stuck run must never wedge the duty.

   Exit after resolving — that is your single mutation this tick.

2. **Else (nothing in flight)** → pick the **oldest open fix PR** that addresses a
   QA finding and carries none of the three outcome labels yet:
   ```
   gh pr list --state open --json number,headRefName,labels,createdAt
   ```
   For each candidate, confirm its linked issue is a QA finding
   (`gh issue view <issue> --json labels` shows `severity:P*` + `goal:qa*`).
   The head branch is `<issue>-...`, so the leading number is the finding issue.
   If none qualify, idle. For the chosen PR:
   1. Resolve its **preview URL** — read the latest successful Preview deployment
      for the PR head SHA:
      `gh api repos/{owner}/{repo}/deployments --jq '[.[] | select(.environment|test("[Pp]review"))][0]'`
      then its `statuses_url` → `target_url`. If no preview is live yet, idle
      (a fix with no preview can't be re-verified).
   2. Open a tracking issue:
      `gh issue create --title "QA verify: PR #<pr> (finding #<issue>)" --label kody:qa-verify --body "Re-verify fix PR #<pr> against its preview; qa-engineer reports here."`
   3. Dispatch the re-check **against the preview**, passing the finding so
      qa-engineer replays the original steps:
      `gh issue comment <tracking> --body "@kody qa-engineer --url <previewUrl> --scope \"Re-verify finding #<issue>: <title>. Replay the Steps/Expected/Actual from issue #<issue> and report PASS only if Actual now matches Expected.\" --issue <tracking>"`
   4. Mark the PR in flight: `gh pr edit <pr> --add-label kody:qa-verifying`.
      Set `data.inflightPr = <pr>`, `data.inflightIssue = <tracking>`.

## Inbox recommendation format

One comment, terse. It **MUST** `@`-mention the operator on the first line —
that mention is the only thing that routes it into the dashboard inbox:

```
{{mentions}} 🔁 **QA re-verify** — `<action>`

<one or two sentences: which fix PR, the verdict, what still reproduces (if any)>

<!-- kody-cmd: @kody fix --pr <pr> "<what still reproduces>" -->

_Confirm or dismiss in the dashboard inbox. QA will not act on its own._
```

`<action>` is `verified` (PASS — fix confirmed) or `fix` (CONCERNS/FAIL — bug
still present).

- **PASS → omit the `kody-cmd:` line entirely.** The fix is confirmed; the rec is
  informational and the operator just dismisses it.
- **CONCERNS / FAIL → the `kody-cmd:` line is required:**
  `@kody fix --pr <pr> "<concern>"`. This re-opens work on the **existing** PR
  branch with the concern as feedback. The Approve button posts the line
  verbatim, so it MUST start with `@kody fix --pr`, be one line, ≤ 300 chars.
  **Never emit `@kody approve`** — the engine has no `approve` verb.

## Allowed Commands

- `gh pr list`, `gh pr view`, `gh pr edit` (labels only).
- `gh issue list`, `gh issue create`, `gh issue view`, `gh issue comment`, `gh issue close`.
- `gh api repos/{owner}/{repo}/deployments` (+ statuses) to resolve the preview URL.

## Restrictions

- **Advisory on outcomes.** Dispatching `qa-engineer` is read-only (it never
  commits). The `fix` rec is a recommendation only — never merge, approve a
  PR/review, or run a fix yourself. Labels and the tracking issue are the only writes.
- **One run in flight at a time.** If any open issue carries `kody:qa-verify`,
  never start a second run this tick.
- **Re-verify each PR once.** A PR carrying any of `kody:qa-verified` /
  `kody:qa-verify-failed` / `kody:qa-verifying` is skipped. The label swap is what
  stops re-processing.
- If `gh ... --label kody:qa-verify` fails because a label is missing, create it
  (`gh label create kody:qa-verify --description "Kody: QA fix re-verification"`,
  same for the three PR labels) and retry — the in-flight check depends on it.
- All writes go through `gh` — never `git commit`/`git push`, never open a PR.

## State

- `cursor`: `idle` | `awaiting-result`.
- `data.inflightPr`: number | null — the PR currently being re-verified.
- `data.inflightIssue`: number | null — its tracking issue.
- `data.nextEligibleISO`: always emit — surfaced as "next run" on the dashboard.
- `done`: always `false` — QA is evergreen.
