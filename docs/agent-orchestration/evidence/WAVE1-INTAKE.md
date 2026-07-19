# Wave 1 Intake Evidence

- Date: 2026-07-19
- Integration branch: `codex/agent-bench-integration`
- Accepted tasks: `VAB-T01`, `VAB-T02`, `VAB-T04`, `VAB-T07`
- Blocked task: `VAB-T06`

## Accepted work

The following task-specific tests passed after selective cherry-pick onto a clean worktree based on
the accepted VAB-T00 baseline:

- `VAB-T01`: `node tests/runners/run.mjs` — 38/38.
- `VAB-T02`: `node tests/fixtures/run.mjs` — 23/23.
- `VAB-T04`: `node tests/evaluators/core/run.mjs` — 42/42.
- `VAB-T07`: `node tests/reporting/run.mjs` — 27/27.
- Combined `npm test` and `git diff --check` — pass.

Two submitted branches included another task's ancestor commit. Integration used their individual
task commits rather than merging complete branches:

- `VAB-T04` branch also contained the VAB-T01 commit.
- `VAB-T02` branch also contained the VAB-T06 commit.

`package.json` had an expected conflict between VAB-T02 and VAB-T04 test scripts. The integration
resolution preserves contract, evaluator-core and fixture checks. Runner and reporting tests were
run explicitly; VAB-T08 should add their scripts to the permanent aggregate test command.

## Blocked work

`VAB-T06` fails one of its own declared checks:

```text
run evidence reader summarizes the sample run
Expected workspace_diff_present === true, received false
```

The sample fixture includes `run-spec.json` and `result.json` but no
`artifacts/workspace.diff`, while the test asserts that the diff exists. This is a reproducible
fixture/contract mismatch, not an environment dependency. T06 is not integrated and needs a
task-scoped correction followed by its 26/26 test run.

## Resulting readiness

- `VAB-T03` is `ready`: its only dependency, VAB-T02, is accepted.
- `VAB-T05` remains planned until VAB-T03 is accepted.
- `VAB-T08` remains planned; it will own final CLI wiring and the permanent combined test command.
