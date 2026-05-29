# Kody Duty Review

_Rolling 6h cycle — one duty deep-reviewed per tick._

Cycle 2 — 0 healthy, 0 warn, 5 broken, 19 pending of 24 duties.

| Duty | Staff | Cadence | Verdict | Note |
|------|-------|---------|---------|------|
| approval-gate | cto | 15m | broken | state.json never created; 0 commits to state file despite 2 commits to body; data.prs persistence impossible across ticks |
| architecture-audit | cto | 7d (disabled) | — | pending |
| ceo-performance-review | ceo | 7d | broken | state.json never created; report exists so duty ran, but promised state file was never persisted |
| cleanup-branches | coo | manual | — | pending |
| clear-empty-goals | — | 1d | — | pending |
| coverage-floor | kody | 1d (disabled) | — | pending |
| dead-code-sweep | kody | 30d (disabled) | — | pending |
| dependency-bump | kody | 7d (disabled) | — | pending |
| design-review | ux-designer | 7d | — | pending |
| docs-code | tech-writer | 1d (disabled) | — | pending |
| docs-readme | tech-writer | 1d (disabled) | — | pending |
| flaky-test-quarantine | kody | 1d (disabled) | — | pending |
| health-check | kody | 1d | — | pending |
| job-gap-scan | ceo | — | broken | state.json persisted to .kody/jobs/ (legacy path) while body says .kody/duties/; migration moved file but script still writes to old location; two non-identical state files exist |
| pr-health-triage | cto | 15m | — | pending |
| publish-release | cto | manual | — | pending |
| qa-sweep | qa | 1d (disabled) | broken | lastRunISO frozen at 2026-05-23; duty body updated 2026-05-28 but state not; cursor idle with no open issue — duty completed but engine stopped invoking 5+ days ago |
| qa-verify | qa | 30m (disabled) | broken | state.json never created; duty body created 2026-05-27, 0 commits to state file ever; data.inflightPr, data.inflightSinceISO never persisted |
| qa | qa | 30m (disabled) | — | pending |
| redispatch | kody | 30m | — | pending |
| security-audit | cto | 1d | — | pending |
| system-audit | coo | 30m | — | pending |
| task-memory-extractor | coo | 30m | — | pending |
| type-debt | kody | 7d (disabled) | — | pending |