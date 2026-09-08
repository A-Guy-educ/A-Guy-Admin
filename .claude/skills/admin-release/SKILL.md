---
name: admin-release
description: Cut and ship an Admin release end-to-end, mirroring the daily release loop. Prepares a release PR into dev (version bump + CHANGELOG), promotes dev → main, deploys to Vercel production, pushes a fresh Docker image to GHCR for Render, and verifies the new version is live at a-guy-admin.vercel.app. Use when the user says "release admin", "cut an admin release", "ship an admin version", or asks to promote admin dev to prod.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Admin Release Skill

Sibling of the `web-release` skill in [A-Guy-Web](../../../../A-Guy-Web/.agents/skills/web-release/SKILL.md). Same pipeline shape, different targets.

**Finish line:** a new semver tag lands on `main`, `vercel --prod` completes, a fresh Docker image lands on GHCR, and [a-guy-admin.vercel.app/admin](https://a-guy-admin.vercel.app/admin) responds with the new version. Vercel and Render currently co-exist as prod — both must be updated per release; the user manually re-deploys Render from the pushed image at the end.

**Cross-repo context lives in [`../../../../CLAUDE_SHARED.md`](../../../../CLAUDE_SHARED.md).** Read it before running for the first time — Vercel auto-deploy is OFF and the alias/scope gotchas will bite you.

---

## Preconditions

Run all of these before starting. If any fails, stop and surface the error to the user.

```bash
# 1. Right repo, right dir
test -f kody.config.json || { echo "Not in A-Guy-Admin root"; exit 1; }
grep -q '"name": "a-guy"' package.json || { echo "package.json doesn't look like the Admin repo"; exit 1; }

# 2. Correct GitHub identity (default account has no repo access)
gh auth switch --user aguyshayb

# 3. Vercel CLI is logged in to the aguy team scope
vercel whoami   # expect "aguyshayb-6573"

# 4. Working tree clean (no untracked release artifacts)
git status --porcelain
```

---

## Stage 0 — Pre-flight review

**Always run this before Stage 1.** Report findings to the user and wait for a go/no-go decision before proceeding. The goal is to surface anything that would make this release risky, misleading, or dead on arrival.

### 0a. Collect the commit set

```bash
git fetch origin dev main
LAST_RELEASE_SHA=$(git log origin/dev --grep="^chore: release v" --format="%H" -n 1)
COMMITS=$(git log --format="%H %s" "${LAST_RELEASE_SHA}..origin/dev")
FILES_CHANGED=$(git diff --name-only "${LAST_RELEASE_SHA}..origin/dev")
```

### 0b. Classify commits (with compound-prefix unwrap)

Kody's convention is to prefix everything with `chore:` even when the underlying change is a `feat` or `fix` (e.g., `chore: feat(footer): ...`, `chore: fix(prep7): ...`). A naive first-token classifier undercounts the release.

**Unwrap compound prefixes before classifying:**

```javascript
// pseudocode — Claude applies this per commit subject
function classify(subject) {
  // strip a leading "chore: " (or "chore(scope): ") wrapper if the *next*
  // token is itself a conventional prefix
  const unwrapped = subject.replace(
    /^chore(\([^)]*\))?:\s+(?=(feat|fix|perf|refactor|docs|build|test|style|ci|chore)[!(:])/,
    '',
  )
  const m = unwrapped.match(
    /^(feat|fix|perf|refactor|docs|build|test|style|ci|chore)(\([^)]*\))?(!)?:/,
  )
  if (!m) return 'unknown' // ← surface these to the user, don't silently drop
  const [, type, , breaking] = m
  if (breaking) return 'major'
  if (type === 'feat') return 'minor'
  if (['fix', 'perf', 'refactor', 'docs', 'build'].includes(type)) return 'patch'
  return 'none' // chore/test/style/ci
}
```

Also scan commit **bodies** for `BREAKING CHANGE:` — a footer-declared break overrides subject classification to `major`.

### 0c. Findings to report

Before proposing the version bump, print a review to the user covering:

1. **Version proposal** — `CURRENT → NEXT` and which commits drove the highest bump.
2. **Unknown-classification commits** — subjects that didn't match any prefix at all (Kody's `Merge pull request #NNN from ...` merges usually fall here; that's fine, but flag anything else so it doesn't get silently dropped from the CHANGELOG).
3. **Breaking-change candidates** — any `feat!:`, `fix!:`, or `BREAKING CHANGE:` mention. Kody has never shipped a major bump; surface these hard so the user can confirm the semver intent.
4. **Sensitive-path touches** — grep `FILES_CHANGED` for any of:
   - `src/collections/**` (Payload schema)
   - `src/app/api/webhooks/**` (Stripe/PayPal — remember the deferred 30s webhook bug in [`../../../CLAUDE_INTERNAL.md#stripe-webhook-handler`](../../../CLAUDE_INTERNAL.md))
   - `src/lib/payment/**`
   - `src/lib/auth/**`
   - `payload.config.ts`
   - `next.config.ts`
   - `middleware.ts`
   - `package.json` dependencies (not the version line)
   - `.env.example` or any `*.env*` file
   - `infra/**` or `docker-compose*`

   For each match, name the file + the PR/commit. The user decides whether the change needs a special deploy note or a smoke check beyond the default.

5. **Env-var deltas** — grep for new `process.env.<VAR>` reads that don't appear on `main`. Vercel snapshots env vars at deploy-creation, so new variables must be added to the Vercel project dashboard **before** Stage 4, otherwise the production build silently reads `undefined`.
6. **DB migration presence** — any files matching `src/migrations/**` or `**/migrations/**`. Payload/Mongo migrations don't auto-run in this project, so a migration in the release set means someone has to run it manually.
7. **Open PRs targeting `dev` or `main`** — `gh pr list --base dev --state open` and `--base main`. A promotion PR conflicts if someone else has an open `dev → main` PR; a release PR conflicts if there's already an open one.
8. **CI health of `dev` HEAD** — `gh run list --branch dev --limit 5 --json name,conclusion,headSha`. If the latest run is failing or in-flight, releasing on top would ship a red commit. Halt.
9. **Version drift** — compare `package.json` version, the latest `chore: release v` commit on `dev`, and `git tag --sort=-v:refname | head -1`. If any three disagree, note it. (As of the skill's authoring, the last git tag was `v0.26.0` but `package.json` was `v0.26.9` — Kody stopped pushing tags. Stage 5 fixes this going forward.)
10. **Dependency changes** — `git diff LAST_RELEASE_SHA..origin/dev -- package.json pnpm-lock.yaml` — if any prod deps changed, list them. New deps can shift bundle size or introduce runtime surprises.

### 0d. Decision gate

Print the review as a compact markdown summary (bullets, not prose) and **wait for explicit confirmation** before running Stage 1. If the user says "go", proceed. If the user says "hold" or asks for changes, adjust and re-run Stage 0.

Do NOT auto-proceed even if every check is green — the review's value is the human beat, not just the checks.

---

## Stage 1 — `release-prepare`

Kody's `release-prepare` bumps `package.json`, rewrites the CHANGELOG entry, and opens a `chore: release vX.Y.Z` PR into `dev`. Replicate that here.

### 1a. Sync `dev`

```bash
git fetch origin dev
git checkout dev
git pull origin dev
```

### 1b. Determine the next version

Reuse the classifier from Stage 0b (with the `chore: <type>:` compound-prefix unwrap). Highest-priority bump wins. If Stage 0 was skipped for any reason, run the classifier here fresh.

If every commit classifies as `none`, still ship a **patch** — Kody does this too (see the empty CHANGELOG entries for v0.26.1 → v0.26.9). Bump `package.json` in-place:

```bash
NEXT=<computed>
node -e "const fs=require('fs');const p=require('./package.json');p.version='$NEXT';fs.writeFileSync('./package.json', JSON.stringify(p,null,2)+'\n');"
```

### 1c. Regenerate the CHANGELOG entry

Kody's `release-prepare` has been shipping empty `_No notable commits since the last release._` entries across recent releases in both repos (root cause was the compound-prefix classifier — see Stage 0b). Do better here:

1. Prepend a new section to [CHANGELOG.md](../../../CHANGELOG.md) — insert directly after the top-level `# Changelog` line.
2. Header format: `## vX.Y.Z — YYYY-MM-DD` (em-dash, ISO date).
3. Under it, group commits under `### Features`, `### Bug Fixes`, `### Performance`, `### Refactor`, `### Docs`. Skip empty sections.
4. Strip the conventional-commit prefix from each subject; keep the human-readable part.
5. If there truly are only `chore:`/`ci:`/`test:` commits, write `_Maintenance-only release._` — do NOT reuse Kody's placeholder.

### 1d. Open the release PR

```bash
BRANCH="release/v${NEXT}"
git checkout -b "$BRANCH"
git add package.json CHANGELOG.md
git commit -m "chore: release v${NEXT}" -m "Bumps package.json to ${NEXT} and updates CHANGELOG."
git push -u origin "$BRANCH"

gh pr create \
  --base dev \
  --head "$BRANCH" \
  --title "chore: release v${NEXT}" \
  --body "$(cat <<EOF
Automated release PR opened by the admin-release skill.

## v${NEXT} — $(date +%Y-%m-%d)

<paste the CHANGELOG section here>

The skill will merge this into \`dev\`, then open a promotion PR into \`main\`, then run \`vercel --prod\`.
EOF
)"
```

Capture the PR number as `RELEASE_PR`.

**Note on Bash tool output capture:** git commit and push may swallow stdout on this machine — see [`../../../CLAUDE_INTERNAL.md#claude-code-bash-tool-git-commitpush-output-not-captured`](../../../CLAUDE_INTERNAL.md) and redirect to `/c/Users/kotz9/git-out.txt` if a command appears to fail silently.

---

## Stage 2 — `release-merge`

Wait for CI on the release PR and merge it into `dev`.

```bash
gh pr checks "$RELEASE_PR" --watch --interval 15
gh pr merge "$RELEASE_PR" --squash --delete-branch
```

If CI fails, invoke `@kody fix-ci` on the PR and re-watch — do not merge with red checks.

Capture the merge SHA:

```bash
MERGE_SHA=$(gh pr view "$RELEASE_PR" --json mergeCommit --jq .mergeCommit.oid)
```

---

## Stage 3 — `release-promote`

Kody opens a PR titled `promote: dev -> main (vX.Y.Z)` (see #763, #751, #738, #713, #700 for the pattern). Do the same.

```bash
git fetch origin dev main
git checkout dev
git pull origin dev

gh pr create \
  --base main \
  --head dev \
  --title "promote: dev -> main (v${NEXT})" \
  --body "$(cat <<EOF
Automated release promotion PR opened by the admin-release skill — promotes \`dev\` to \`main\` for release **v${NEXT}**.

<!-- kody-changelog-start -->
## What's changing in v${NEXT}

<paste the CHANGELOG section again>
<!-- kody-changelog-end -->

Merge this PR to promote v${NEXT} to \`main\`.
EOF
)"
```

Capture as `PROMOTE_PR`. Wait for checks and merge with a **merge commit** (not squash — this preserves the promotion trail):

```bash
gh pr checks "$PROMOTE_PR" --watch --interval 15
gh pr merge "$PROMOTE_PR" --merge
```

At this point [`.github/workflows/vercel-deploy.yml`](../../../.github/workflows/vercel-deploy.yml) will fire on push to `main`, but per [`../../../../CLAUDE_SHARED.md`](../../../../CLAUDE_SHARED.md) Vercel git-integration is off and this workflow is what actually runs `vercel deploy --prod`. Verify the workflow run started:

```bash
gh run list --workflow=vercel-deploy.yml --limit 1
```

If the workflow doesn't fire or fails, fall back to the manual deploy in Stage 4.

---

## Stage 4 — `vercel-production-deploy`

This is the stage Kody's config lists but doesn't reliably complete — the recent goal issues (#756, #749, #713) all stop at Stage 3. Close the loop here.

### 4a. Ensure the local checkout is at the tip of `main`

```bash
git checkout main
git pull origin main
```

### 4b. Run `vercel --prod` (background — build is 3–5 min)

Run in background per the deploy ritual in [`../../../../CLAUDE_SHARED.md`](../../../../CLAUDE_SHARED.md):

```bash
vercel --prod --yes
```

`vercel --prod --yes` builds AND aliases in one step. **Do NOT** run `vercel alias` after this — that's only for the dev flow. And **NEVER** alias a preview build to `a-guy-admin.vercel.app` (that's the prod alias).

Wait for the deploy URL to appear, then confirm the alias landed:

```bash
vercel inspect <deploy-url> --scope aguy   # should show a-guy-admin.vercel.app in the aliases list
```

---

## Stage 4.5 — Render Docker image push

Vercel and Render both serve prod right now (co-existence phase). After Vercel is deployed, build a fresh Docker image from `main` and push it to GHCR so Render can pick it up.

Render's build memory caps at 8GB on any plan (Performance Builds is a separate paid opt-in) and Payload + Next + Sentry consistently OOMs there — so we build locally and Render just pulls the image. See [`../../../CLAUDE_INTERNAL.md#render-migration-poc`](../../../CLAUDE_INTERNAL.md) if it exists, otherwise treat this stage as the current source of truth.

### 4.5a. Build and push the image

```bash
git checkout main
git pull origin main
docker build \
  -t "ghcr.io/aguyshayb/a-guy-admin:$(git rev-parse --short HEAD)" \
  -t ghcr.io/aguyshayb/a-guy-admin:latest \
  .
docker push "ghcr.io/aguyshayb/a-guy-admin:$(git rev-parse --short HEAD)"
docker push ghcr.io/aguyshayb/a-guy-admin:latest
```

Expected outcome: two tags land on GHCR — a SHA-pinned one (for rollback traceability) and `:latest` (what Render's service is configured to pull). The build itself runs on the release machine, not on Render, so the SKIP_SENTRY / build:docker hacks in the Dockerfile are still what runs — no code changes needed.

**Preconditions to verify before running:**

- Docker Desktop is running (`docker info` returns a daemon, not "cannot connect to daemon")
- GHCR auth is live (`docker login ghcr.io` — token needs `write:packages` scope; use `gh auth token` if the current gh account is `aguyshayb` with that scope)

If either fails, stop and surface it to the user — don't skip this stage silently.

### 4.5b. Remind the user to deploy on Render

**The image is on GHCR but Render will not auto-pull.** Print a hard reminder to the user in the release summary:

> **⚠ MANUAL STEP REQUIRED:** New image `ghcr.io/aguyshayb/a-guy-admin:<SHA>` is on GHCR.
> Go to Render dashboard → `a-guy-admin` service → **Manual Deploy** → **"Deploy latest reference"**.
> Render will pull `:latest` and swap the container. Expect ~1 min swap, then ~15-30s onInit boot.

Do NOT proceed to Stage 5 until the user confirms they've triggered the Render deploy (or explicitly says to skip it). This is where the release actually reaches Render users; forgetting it leaves prod-on-Render running the previous image.

### 4.5c. Verify Render is live on the new image (optional but recommended)

Once the user confirms they've triggered the Render redeploy, wait for it to finish and hit the Render URL:

```bash
# Should return 200 and, if you added a version endpoint, the new version
curl -sI https://a-guy-admin.onrender.com/admin | head -3
```

If the response is slow (>30s) that's the onInit boot — normal after a redeploy. If it 500s or returns Render's "Service is starting up" splash after the deploy is marked Live, something's wrong with the image; check the Render service logs.

---

## Stage 5 — Tag & GitHub release

Kody's config points at semantic-release (see [`docs/releases.md`](../../../docs/releases.md)) but the tags stopped at `v0.26.0` while package.json advanced to `v0.26.9` — semantic-release isn't running. Create the tag ourselves:

```bash
git tag -a "v${NEXT}" -m "Release v${NEXT}"
git push origin "v${NEXT}"

gh release create "v${NEXT}" \
  --title "v${NEXT}" \
  --notes "$(sed -n "/^## v${NEXT} /,/^## /p" CHANGELOG.md | sed '$d')" \
  --target main
```

---

## Stage 6 — Verify on production

Two verification commands from [kody.config.json](../../../kody.config.json) `release`. Run both.

### 6a. Smoke

The Admin repo doesn't have a dedicated `smoke-web-api.ts` equivalent (only [scripts/release-e2e-gate.ts](../../../scripts/release-e2e-gate.ts) and paypal-key/smoke-test helpers). Fall back to targeted HTTP probes until a proper smoke script exists:

```bash
# /admin should serve the Payload admin login page (200)
curl -sI https://a-guy-admin.vercel.app/admin | head -3

# The Payload REST base health — /api/access returns a JSON policy summary
curl -sf https://a-guy-admin.vercel.app/api/access -o /dev/null && echo "access endpoint ok" || echo "access endpoint FAILED"

# Any known collection list — pick one that requires no auth to enumerate meta,
# e.g. products or courses (adjust to a public-list collection if these are restricted):
curl -sf "https://a-guy-admin.vercel.app/api/products?limit=1" -o /dev/null && echo "products list ok" || echo "products list FAILED"
```

**Follow-up (nice to have):** port `A-Guy-Web/scripts/smoke-web-api.ts` here with Admin-shaped assertions — the Web equivalent hits chat, media, PDF viewer. The Admin version should hit login, a Payload collection list, and the admin dashboard load.

### 6b. Version check

```bash
# The prod deployment should serve the new package.json version somewhere.
# Sanity-check by hitting a health/version endpoint if one exists, otherwise
# curl the homepage and grep for a build ID that matches the new deploy.
curl -sSI https://a-guy-admin.vercel.app/admin | grep -i "x-vercel-id"
```

### 6c. E2E gate (optional — 30 min, needs Docker)

```bash
npx tsx scripts/release-e2e-gate.ts
```

Skip this locally unless you're debugging a suspect flow — CI is a better environment for it.

---

## Stage 7 — Close the loop

If a Kody goal issue is open (`gh issue list --search 'admin-release in:body' --state open`), comment on it and close it:

```bash
GOAL_ISSUE=$(gh issue list --search "admin-release-$(date +%Y-%m-%d) in:body" --state open --json number --jq '.[0].number')

if [ -n "$GOAL_ISSUE" ]; then
  gh issue comment "$GOAL_ISSUE" --body "✅ v${NEXT} shipped: promotion PR #${PROMOTE_PR} merged, \`vercel --prod\` succeeded, smoke passed against a-guy-admin.vercel.app."
  gh issue close "$GOAL_ISSUE" --reason completed
fi
```

---

## Failure handling

| Stage fails at                      | Action                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preconditions                       | Surface the exact command that failed, do not proceed                                                                                                                                                                                                                                                      |
| Stage 1 CI                          | Comment `@kody fix-ci` on the PR, re-watch, then merge                                                                                                                                                                                                                                                     |
| Stage 3 CI                          | Same — `@kody fix-ci`, then merge                                                                                                                                                                                                                                                                          |
| Stage 4 `vercel --prod` build error | Read the build log, fix on `dev`, re-promote, re-deploy — do NOT alias a broken build                                                                                                                                                                                                                      |
| Stage 4.5 `docker build` error      | Read the build log, fix on `dev`, re-promote, retry — Render stays on the previous image so prod-on-Render is not broken, only stale                                                                                                                                                                       |
| Stage 4.5 `docker push` error       | Usually GHCR auth expired. Re-run `gh auth switch --user aguyshayb` + `gh auth token \| docker login ghcr.io -u aguyshayb --password-stdin`, retry.                                                                                                                                                        |
| Stage 6 smoke fails                 | Deployment is live but broken. Roll back via `vercel rollback` (identify prior prod deploy via `vercel ls --prod --scope aguy`) and open a bug issue. For Render, manually re-deploy the previous SHA-pinned image tag from GHCR (Render dashboard → Manual Deploy → change image URL to prior `:sha` tag) |

---

## Non-negotiables

- **Never alias a preview build to `a-guy-admin.vercel.app`.** That's the prod alias. The rest of the alias/scope story is in [`../../../../CLAUDE_SHARED.md`](../../../../CLAUDE_SHARED.md).
- **Never skip Stage 6.** "Merged to main" is not "shipped." The whole reason this skill exists is that Kody's pipeline stops at Stage 3.
- **Never skip Stage 4.5.** Vercel and Render both serve prod right now; Vercel-only deploy leaves Render running the previous image. Push the Docker image every release, and remind the user to click Manual Deploy on Render — do not silently move on to Stage 5.
- **Never squash-merge the promotion PR.** Merge commit preserves the promotion boundary — future release-prepare stages walk `git log` back to the previous release commit.
- **Never bump `package.json` on `dev` without opening a release PR.** All version changes go through Stage 1.

---

## Keeping this in sync with `web-release`

This skill was forked from [`A-Guy-Web/.agents/skills/web-release/SKILL.md`](../../../../A-Guy-Web/.agents/skills/web-release/SKILL.md). The pipeline logic (Stages 0–7) is meant to stay identical across the two repos. Only these things should differ:

- **Preconditions repo check** — `Not in A-Guy-Admin root` + `"name": "a-guy"` package.json probe (Web probes for its own markers)
- **Prod URL** — `https://a-guy-admin.vercel.app/admin` here vs `https://www.aguy.co.il` in Web
- **Smoke command (Stage 6a)** — Web has `scripts/smoke-web-api.ts`; Admin currently uses `curl` probes and needs a dedicated smoke script written (see the follow-up note in Stage 6a)
- **Goal-issue identifier (Stage 7)** — `admin-release-<date>` here vs `web-release-<date>` in Web

When the Web skill improves (e.g., better classifier, new pre-flight check), port the change here — don't let the two drift.
