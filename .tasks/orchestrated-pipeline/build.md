# Build Agent Report: orchestrated-pipeline

## Branch

- **Branch:** `feat/orchestrated-pipeline`

## Changes

- **`.github/workflows/pipeline-orchestrated.yml`** - New workflow with two-job architecture:
  - `parse` job: Read-only, validates trigger (dispatch or comment), extracts parameters, gates execution
  - `orchestrate` job: Write permissions, obtains GitHub App token, runs orchestrator
  - Supports `workflow_dispatch` and `issue_comment` triggers
  - Safety filters: bot filter, author_association gating, pattern matching (`^/oc\s+`)
  - Concurrency: `task_id || issue.number` fallback

- **`scripts/orchestrator.ts`** - Central orchestration logic (~400 lines):
  - CLI argument parsing via orchestrator-utils
  - Modes: spec, impl, full, rerun, status
  - Agent execution with file watching, timeouts
  - Status management (status.json)
  - Comment posting to GitHub issues

- **`scripts/orchestrator-utils.ts`** - CI utilities (~350 lines):
  - Types: OrchestratorInput, PipelineStatus, StageStatus
  - Status file management (read/write/update)
  - GitHub API helpers (postComment, getIssueComments)
  - CLI argument parsing
  - Auth validation (OPENCODE_GITHUB_TOKEN)
  - Formatting helpers (duration, status comments)

- **`tests/unit/scripts/orchestrator.spec.ts`** - Full test suite for orchestrator.ts (50 tests):
  - Unit tests for CLI argument parsing (parseCliArgs)
  - Auth validation tests (validateAuth)
  - Status management tests (initStatus, updateStageStatus, readStatus, completeStatus)
  - Pipeline flow tests (runSpecPipeline, runImplPipeline, runRerunPipeline logic)
  - File watch/timeout detection tests
  - Failure handling tests
  - Retry logic documentation
  - Status comment formatting tests
  - GitHub comment posting tests
  - Validation helpers tests (isValidMode, isValidStage, validateTaskId)
  - Edge case tests

- **`docs/pipeline-orchestrated-plan.md`** - Full plan documentation (~480 lines)

- **`package.json`** - Added `"pipeline:orchestrate": "pnpm tsx scripts/orchestrator.ts"` script

## Quality

- TypeScript: **PASS** (`pnpm typecheck`)
- Lint: **PASS** (pre-existing warnings only, no errors in new files)
- Build: **PASS** (full build completed)
- Unit Tests: **PASS** (all 181 tests passed - 50 new orchestrator tests + 131 existing)

## Commits

- `06eb3861` feat(pipeline): Add orchestrated GitHub Actions pipeline

## Notes

- Branch pushed to origin. PR to dev can be created with:
  ```bash
  gh pr create --base dev --head feat/orchestrated-pipeline
  ```
- Coexists with existing `pipeline.yml` (local pipeline)
- Uses `OPENCODE_GITHUB_TOKEN` env var for GitHub App authentication
- All LLM provider keys available (MINIMAX_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, OPENCODE_API_KEY)
