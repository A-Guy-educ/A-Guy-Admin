# Kody Health Check

## Job

Daily digest of **tasks already assigned to Kody** — any open issue carrying an active `kody:*` lifecycle label other than `kody:done` — that **haven't been updated in the last 6 hours**. Purely diagnostic: never re-kicks, closes, or relabels anything. The operator reads the digest and decides what (if anything) to nudge.

**Cadence guard.** If `data.lastRunISO` is set and within the last 20 hours, emit unchanged state and exit. Otherwise proceed and update `data.lastRunISO` to now (UTC ISO) when you post.

**Per tick (one action max):**

1. Locate or create the rolling tracking issue:
   ```
   gh issue list --label "kody:health-check" --state open --json number,title --limit 5
   ```
   If none exists, create one and stash `data.trackingIssue`:
   ```
   gh issue create \
     --title "kody: health check (assigned tasks)" \
     --label "kody:health-check" \
     --body "Rolling digest of Kody-assigned tasks that haven't been touched in >6h. Updated daily by the health-check job. Comment-only — no automated actions are taken from this issue."
   ```
   Creating the issue counts as the tick's one action — exit and post the digest on the next tick.

2. For each label below, list open issues and **filter client-side** to those whose `updatedAt` is older than `now - 6h`:
   ```
   gh issue list --state open --label "<label>" --json number,title,url,updatedAt --limit 100
   ```
   Labels to scan (skip `kody:queued` only if the user later asks; for now include all active):
   - `kody:queued`, `kody:running`, `kody:fixing`, `kody:resolving`, `kody:reviewing`, `kody:syncing`, `kody:needs-fix`, `kody:failed`

3. Build a digest grouped by phase. Each line:
   `- #<n> <title> — <hours>h since last update — <url>`
   If every phase reports zero stuck issues, the digest body is one line: `All Kody-assigned tasks were updated within the last 6h. ✨`. Skip empty phases — keep the digest short.

4. Post the digest as a **single comment** on the tracking issue:
   ```
   gh issue comment <data.trackingIssue> --body "$(printf '...')"
   ```
   Lead the comment with a one-line summary: `**N stuck across M phase(s)** — threshold 6h, scanned <ISO>`.

5. Update state: `cursor: reported`, `data.lastRunISO = <now ISO>`, `data.lastStuckCount = <total>`.

## Allowed Commands

- `gh issue list`, `gh issue view`, `gh issue create`, `gh issue comment`, `gh label create`

## Restrictions

- **Never** edit, close, label, or re-kick the issues being scanned. Comment-only on the tracking issue.
- **Never** edit files in the working tree. **Never** commit. **Never** push.
- Maximum **one** comment posted per tick. Maximum one issue created per tick.
- If `gh issue create --label kody:health-check` fails because the label doesn't exist, run `gh label create kody:health-check --description "Kody job: assigned-task health check" --color ededed` and retry the create. **Do not skip the label** — the next-tick "find tracking issue" lookup depends on it.
- "Stuck" threshold is **6 hours** since `updatedAt`. It's set here in the body — don't infer it from data.
- `kody:done` is **never** included in the scan. That's a terminal state.

## State

- `cursor`: `idle` | `reported` | `stalled`
- `data.lastRunISO`: ISO timestamp of the last tick that posted a digest (or null)
- `data.trackingIssue`: number of the rolling tracking issue (or null until first run)
- `data.lastStuckCount`: count of stuck tasks in the last digest (or 0)
- `data.nextEligibleISO`: UTC ISO timestamp this job will next be eligible to act, computed from the cadence guard above. **Always emit this, every tick.** For this job: `data.lastRunISO + 20h`. Surfaced as "next run" on the dashboard.
- `done`: always `false` — this job is evergreen.
