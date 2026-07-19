# Wave 1 Intake Evidence

- Date: 2026-07-19
- Integration branch: `codex/agent-bench-integration`
- Accepted tasks: `VAB-T01`, `VAB-T02`, `VAB-T04`, `VAB-T06`, `VAB-T07`
- Blocked task: none

## Accepted work

The following task-specific tests passed after selective cherry-pick onto a clean worktree based on
the accepted VAB-T00 baseline:

- `VAB-T01`: `node tests/runners/run.mjs` — 38/38.
- `VAB-T02`: `node tests/fixtures/run.mjs` — 23/23.
- `VAB-T04`: `node tests/evaluators/core/run.mjs` — 42/42.
- `VAB-T06`: `node tests/browser-evidence/run.mjs` — 26/26 after fixture repair.
- `VAB-T07`: `node tests/reporting/run.mjs` — 27/27.
- Combined `npm test` and `git diff --check` — pass.

Two submitted branches included another task's ancestor commit. Integration used their individual
task commits rather than merging complete branches:

- `VAB-T04` branch also contained the VAB-T01 commit.
- `VAB-T02` branch also contained the VAB-T06 commit.

`package.json` had an expected conflict between VAB-T02 and VAB-T04 test scripts. The integration
resolution preserves contract, evaluator-core and fixture checks. Runner and reporting tests were
run explicitly; VAB-T08 should add their scripts to the permanent aggregate test command.

## T06 repair

Initial intake found that the sample fixture omitted `artifacts/workspace.diff`, while its reader
test required that artifact. The fixture was repaired with a minimal synthetic diff and the full
browser-evidence suite now passes 26/26. The repair is fixture-only: it does not claim real browser,
Canvas/WebGL, or visual-regression coverage.

## Resulting readiness

- `VAB-T03` is `ready`: its only dependency, VAB-T02, is accepted.
- `VAB-T05` remains planned until VAB-T03 is accepted.
- `VAB-T08` remains planned; it will own final CLI wiring and the permanent combined test command.
