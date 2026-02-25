# Cody Pipeline

AI agent pipeline for automated feature implementation and bug fixes.

## Trigger

- `@cody [spec|impl|rerun|full|status] [task-id]` on GitHub issues
- `workflow_dispatch` with `task_id` input

## Pipeline Modes

| Mode    | Stages                                                                      |
| ------- | --------------------------------------------------------------------------- |
| `spec`  | taskify → spec → gap → clarify                                              |
| `impl`  | architect → plan-gap → build → commit → verify → auditor → apply-audit → pr |
| `full`  | spec + impl (two-phase)                                                     |
| `rerun` | Resume from failure                                                         |

## Two-Phase Execution

1. **Phase 1**: Run spec stages (taskify, spec, gap)
2. **After taskify**: `resolve-profile` post-action sets `ctx.pipelineNeedsRebuild = true`
3. **Rebuild**: `rebuildPipelineAfterTaskify()` returns full pipeline with BOTH completed + pending stages
4. **Phase 2**: Continue with impl stages

## Profiles

- `standard`: Full pipeline (includes gap, plan-gap, auditor, apply-audit)
- `lightweight`: Skips spec, gap, plan-gap, auditor, apply-audit

Profile is resolved in `resolve-profile` post-action based on:

- Explicit `pipeline_profile` in task.json
- Task type + risk level (fix_bug/refactor/ops + low risk = lightweight)

## Key Files

| File                          | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `entry.ts`                    | Main entry, mode routing                                           |
| `engine/state-machine.ts`     | Pipeline execution loop                                            |
| `pipeline/definitions.ts`     | Stage definitions, stage order                                     |
| `pipeline/post-actions.ts`    | Post-stage actions (validate, resolve-profile, commit, check-gate) |
| `pipeline/skip-conditions.ts` | Stage skip logic                                                   |

## Task Files

Generated in `.tasks/<task-id>/`:

- `task.json` - Task definition (task_type, risk_level, profile)
- `task.md` - Original issue
- `spec.md` - Generated specification
- `plan.md` - Implementation plan
- `gap.md` - Gap analysis
- `status.json` - Pipeline state

## State Machine

```
while (true):
  if ctx.pipelineNeedsRebuild && rebuildPipeline:
    pipeline = rebuildPipeline(ctx)

  nextStep = resolveNextStep(state, pipeline)
  if not nextStep: break  // done

  executeStep(nextStep)
  writeState()

  if state.failed or state.paused: break
```

## Post-Actions (after each stage)

- `validate-task-json` - Ensure task.json is valid
- `resolve-profile` - Set ctx.profile, signal rebuild
- `check-gate` - Pause for approval if needed
- `commit-task-files` - Commit and push

## Important Context

- `ctx.pipelineNeedsRebuild` - Set by `resolve-profile` to trigger two-phase construction
- `ctx.profile` - Resolved after taskify (standard vs lightweight)
- `state.stages[stageName].state` - pending | running | completed | failed | skipped | paused

## Debug

```bash
# Check status
cat .tasks/<task-id>/status.json

# Resume from stage
@cody rerun <task-id> --from build
```
