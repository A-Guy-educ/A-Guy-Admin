# Cody Pipeline Scripts

Cody is the AI-powered development pipeline that runs in CI to implement features and fix bugs automatically.

## Overview

Cody runs a multi-stage pipeline triggered by:

- `@cody` commands on GitHub issues
- `workflow_dispatch` events (manual runs)

The pipeline operates in different modes:

- **spec** - Run only specification stages (taskify, spec, gap)
- **impl** - Run only implementation stages
- **full** - Run full pipeline (spec + impl)
- **rerun** - Resume from a failed stage

## Pipeline Stages

### Spec Stages (First Phase)

| Stage     | Description                                 |
| --------- | ------------------------------------------- |
| `taskify` | Parse issue into structured task definition |
| `spec`    | Generate detailed specification document    |
| `gap`     | Analyze spec for implementation gaps        |
| `clarify` | Q&A loop for clarifying requirements        |

### Impl Stages (Second Phase)

| Stage         | Description                    |
| ------------- | ------------------------------ |
| `architect`   | Design implementation approach |
| `plan-gap`    | Analyze plan for gaps          |
| `build`       | Implement the changes          |
| `commit`      | Commit changes to branch       |
| `verify`      | Run tests and verify           |
| `auditor`     | Review code for issues         |
| `apply-audit` | Apply auditor suggestions      |
| `pr`          | Create pull request            |

## Directory Structure

```
scripts/cody/
├── entry.ts                 # Main entry point, mode routing
├── cody-utils.ts           # Core utilities (readTask, writeState, etc.)
├── pipeline-utils.ts        # Pipeline resolution utilities
├── agent-runner.ts         # GitHub Actions / Local runner
├── runner-backend.ts       # Runner interface
├── git-utils.ts            # Git operations (commit, push, PR)
├── stage-prompts.ts        # System prompts for each stage
├── content-validators.ts   # Validation for stage outputs
├── clarify-workflow.ts     # Q&A loop handling
├── github-api.ts           # GitHub API helpers
├── logger.ts               # Logging utilities
├── preflight.ts            # Pre-flight checks
├── scripted-stages.ts      # Non-agent stages
│
├── engine/                 # Core pipeline engine
│   ├── state-machine.ts    # Main execution loop
│   ├── types.ts            # Type definitions
│   └── pipeline-resolver.ts # Pipeline resolution
│
├── handlers/               # Stage handlers
│   ├── handler.ts          # Main handler dispatcher
│   ├── taskify.ts          # Taskify stage handler
│   ├── spec.ts             # Spec stage handler
│   └── ...
│
└── pipeline/               # Pipeline definitions
    ├── definitions.ts      # Stage definitions & order
    ├── post-actions.ts     # Post-stage actions
    └── skip-conditions.ts # Stage skip logic
```

## Key Concepts

### Two-Phase Pipeline

The "full" mode uses two-phase construction:

1. **Phase 1**: Run spec stages (taskify, spec, gap)
2. **Rebuild**: After taskify, rebuild pipeline to include impl stages
3. **Phase 2**: Run impl stages (architect, build, commit, pr)

This allows the pipeline to:

- Resolve the task profile (standard vs lightweight) after taskify
- Include both completed and pending stages in state

### Pipeline Profiles

- **standard**: Full pipeline with all stages (spec, gap, architect, plan-gap, auditor, apply-audit)
- **lightweight**: Simplified pipeline for low-risk tasks (skips spec, gap, plan-gap, auditor, apply-audit)

### Task Definition (task.json)

```json
{
  "task_type": "implement_feature",
  "risk_level": "medium",
  "confidence": 0.95,
  "primary_domain": "backend",
  "scope": ["collections", "hooks"],
  "pipeline_profile": "standard"
}
```

## Usage

### Trigger via Issue Comment

```bash
@cody full 260225-auto-40
@cody spec 260225-auto-40     # Run spec stages only
@cody impl 260225-auto-40     # Run impl stages only
@cody rerun 260225-auto-40    # Resume from failure
@cody status 260225-auto-40    # Check status
```

### Trigger via Workflow Dispatch

```bash
gh workflow run cody.yml -f task_id=260225-auto-40 --repo owner/repo
```

## Files Generated

The pipeline creates task files in `.tasks/<task_id>/`:

- `task.json` - Task definition
- `task.md` - Original issue content
- `spec.md` - Generated specification
- `plan.md` - Implementation plan
- `gap.md` - Gap analysis
- `status.json` - Pipeline state

## Debugging

### Check Pipeline Status

```bash
# View status.json
cat .tasks/<task-id>/status.json
```

### Resume from Specific Stage

```bash
@cody rerun <task-id> --from build
```

### Dry Run Mode

```bash
@cody full <task-id> --dry-run
```

## Related

- `.github/workflows/cody.yml` - CI workflow
- `tests/unit/scripts/cody/` - Test suite
