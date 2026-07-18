# Kody Duty Review

_Rolling 6h cycle — one duty deep-reviewed per tick._

**Cycle 16** — 1 healthy, 10 warn, 14 broken of 25 duties.

| Duty | Staff | Cadence | Verdict | Note |
|------|-------|---------|---------|------|
| approval-gate | cto | 15m | broken | kody-job-next-state block now present in body, but state file still never created (0 commits to state path, 404) |
| architecture-audit | staff | 7d | broken | script never existed (404) |
| ceo-performance-review | ceo | 1h | broken | kody-job-next-state block never emitted by procedure |
| cleanup-branches | staff | 1d | healthy | passes every check |
| clear-empty-goals | staff | 1h | broken | 0-step body |
| coverage-floor | staff | 1d | broken | script absent (404) |
| dead-code-sweep | staff | 7d | broken | script never implemented |
| dependency-bump | staff | 7d | broken | script absent |
| design-review | staff | 7d | broken | cadence guard (6d) contradicts every: 7d |
| dev-ci-health | staff | 15m | broken | kody-job-next-state present but missing lastRunISO/nextEligibleISO fields |
| docs-code | staff | 7d | broken | no kody-job-next-state block |
| docs-readme | staff | 7d | warn | no kody-job-next-state block |
| flaky-test-quarantine | staff | 1d | warn | no kody-job-next-state block |
| health-check | staff | 5m | warn | no kody-job-next-state block |
| job-gap-scan | staff | 6h | broken | state at legacy .kody/jobs/ path |
| pr-health-triage | staff | 1h | warn | no kody-job-next-state block |
| publish-release | staff | 7d | warn | (disabled) no kody-job-next-state block |
| qa | qa | 7d | broken | lastRunISO frozen 2026-05-23 |
| qa-sweep | qa | 7d | broken | lastRunISO frozen at 2026-05-23 |
| qa-verify | qa | 7d | broken | state.json never created |
| redispatch | staff | 15m | warn | no kody-job-next-state block |
| security-audit | staff | 7d | warn | (disabled) no kody-job-next-state block |
| system-audit | staff | 6h | warn | no kody-job-next-state block |
| task-memory-extractor | staff | 1h | warn | no kody-job-next-state block |
| type-debt | staff | 1d | warn | no kody-job-next-state block |