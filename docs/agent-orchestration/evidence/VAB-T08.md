# VAB-T08 Evidence

- Status: DONE / awaiting independent review
- Baseline: `0f76ad1`
- Branch: `codex/vab-t08-integration`
- Integrated accepted dependency commits:
  - VAB-T00 Contracts: `3492a47`
  - VAB-T01 CLI telemetry: `8fb2efa`
  - VAB-T02 Fixture framework: `76d5293`
  - VAB-T03 Equity Fixture: `e63a6b4`
  - VAB-T04 Evaluator Core: `e1ae8f6`
  - VAB-T05 Equity Evaluator: `a3f64dc`
  - VAB-T06 Browser evidence and review: `636ddda`, repair `b17d3ca`
  - VAB-T07 Reporting: `a8f8b8e`
  - VAB-T09 Macro Map 3D Fixture: `088bdf4`
  - VAB-T10 Heatmap Fixture: `40a53f9`
  - VAB-T11 Playwright Driver: `05413c2`
  - VAB-T12 Macro Map 3D Evaluator: `b5898f4`
  - VAB-T13 Heatmap Evaluator: `b06312a`
  - VAB-T15 Browser hardening: `cc9cf32`
  - VAB-T16 Evaluator trust hardening: `6f46b79`

## Delivered

- One schema v2 RunSpec contract shared by the setup page and CLI.
- `validate`, `build-fixture`, `prepare`, `run`, `evaluate`, `capture`, `report`, and
  `golden` CLI commands with structured result envelopes.
- Primary Case registry for Equity, Macro Map 3D, and AInvest Heatmap.
- File-isolated Fixture preparation with leakage scan and fresh Git baseline.
- Progressive staged CLI runs with checkpointed stage state, raw logs, normalized events,
  actual CLI version, native usage when reported, unavailable markers otherwise, file snapshots,
  Git diff, and a valid human-review placeholder.
- Deterministic golden pipeline for all three primary Cases:
  RunSpec → Fixture → fake staged run → real Chromium capture → attested Evaluator →
  human-review placeholder → JSON/Markdown/HTML report.
- Checkpoint resume that does not repeat completed Fixture or Runner side effects.
- Setup page exports one canonical RunSpec per selected Case; it does not execute or duplicate
  Runner behavior.
- Default `npm test` now includes all accepted Case Evaluators, Fixtures, real-browser tests,
  reporting, E2E, structure, and syntax gates.

## Acceptance

- `npm test` → PASS.
- `node tests/e2e/run.mjs` → PASS, 4/4:
  - all three primary Cases complete the golden pipeline;
  - an injected post-run failure resumes without repeating completed side effects;
  - canonical CLI `prepare`/`run` works against a local executable and records version/usage;
  - a failed real CLI attempt is retained and the failed stage resumes into a new attempt directory.
- `npm run bench:doctor` → PASS, 3/3 CLI tools available:
  Codex 0.144.6, Kimi Code 0.27.0, Claude Code 2.1.177.
- `node scripts/bench.mjs validate --spec config/run-profile.example.yaml` → PASS.
- `git diff --check` → PASS.
- Persistent local acceptance artifact:
  `.local/acceptance/t08/t08-golden-equity/reports/t08-golden-equity.html`.

## Proof boundaries

- Golden uses a deterministic fake adapter and synthetic control-plane observations. It proves
  wiring and recovery only, never model capability; its report is conclusion-ineligible.
- File isolation prevents answer files from being copied into the workspace but cannot stop a
  same-user process from reading arbitrary host paths. Results remain development-only and are
  not leaderboard eligible.
- Browser evidence proves declared DOM/interactions/screenshots and observable Canvas signatures,
  not aesthetics, complete visual correctness, WebGL semantics, or cross-browser behavior.
- Production Evaluators require digest-bound observation attestations. A general collector for
  arbitrary real-model implementations is not yet available; real Pilot reports must mark those
  conclusions unavailable rather than fabricate observations.
- Human visual review and effort/convergence measurements remain required before a leadership
  productivity conclusion.

## Next

- VAB-T14: run the real-model Pilot through Codex, Kimi Code K3, and Claude Code where configured;
  preserve all failures, mark missing token/cost/evaluator fields unavailable, and produce a
  sample-size-limited comparison report for human completion.
