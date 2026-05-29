# Kody Duty Review

_Rolling 6h cycle — one duty deep-reviewed per tick._

## Cycle 2 — 5 broken, 0 warn, 19 pending of 24 duties.

| Duty | Staff | Cadence | Verdict | Note |
|------|-------|---------|---------|------|
| approval-gate | ceo | 7d | broken | state.json never created; 0 commits to state file despite 2 commits to body; data.prs persistence impossible across ticks |
| architecture-audit | cto | 7d | broken | disabled=true but referenced script .kody/scripts/architecture-audit-tick.py does not exist; state path in body still points to deprecated .kody/jobs/ after migration |
| ceo-performance-review | ceo | 7d | broken | state.json never created; report ran once (cycle 1, May 27) but promised lastRunISO, nextEligibleISO, cycle, lastGrades never persisted |
| cleanup-branches | coo | 1d | pending | — |
| clear-empty-goals | coo | 1d | pending | — |
| coverage-floor | cto | 7d | pending | — |
| dead-code-sweep | cto | 7d | pending | — |
| dependency-bump | cto | 14d | pending | — |
| design-review | ux-designer | 7d | pending | — |
| docs-code | tech-writer | 7d | pending | — |
| docs-readme | tech-writer | 7d | pending | — |
| flaky-test-quarantine | qa | 1d | pending | — |
| health-check | kody | 1d | pending | — |
| job-gap-scan | ceo | 14d | broken | state.json persisted to .kody/jobs/ (legacy path) while body says .kody/duties/; migration moved file but script still writes to old location; two non-identical state files exist |
| pr-health-triage | cto | 7d | pending | — |
| publish-release | ceo | 14d | pending | — |
| qa-sweep | qa | 7d | broken | lastRunISO frozen at 2026-05-23; duty body updated 2026-05-28 but state not; cursor idle with no open issue — duty completed but engine stopped invoking 5+ days ago |
| qa-verify | qa | 1d | broken | state.json never created; duty body created 2026-05-27, 0 commits to state file ever; data.inflightPr, data.inflightSinceISO never persisted |
| qa | qa | 7d | pending | — |
| redispatch | coo | 1h | pending | — |
| security-audit | cto | 7d | pending | — |
| system-audit | coo | 6h | pending | — |
| task-memory-extractor | coo | 7d | pending | — |
| type-debt | cto | 14d | pending | — |
