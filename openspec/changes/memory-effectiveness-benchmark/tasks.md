# Tasks: memory-effectiveness-benchmark

Each completed task names its actual owned paths, acceptance evidence, verification,
and rollback. Rollback applies only to those paths and never to unrelated worktree
changes.

## 1. Shared contracts

- [x] 1.1 Implement the canonical experiment and intervention contracts. Owned paths:
  `schemas/memory-experiment-spec.schema.json`,
  `schemas/memory-intervention.schema.json`, and `src/memory/contracts.mjs`.
  Evidence: fixtures enforce Case/version and memory-snapshot controls, exact arms,
  ID prefixes, required `retrievalRunId`, off-arm isolation, approved zero-match hash,
  three-ID cap, and canonical calendar-valid RFC3339 timestamps (uppercase `T`/`Z`,
  nonzero year, hour 00–23, second 00–59). Verification:
  `npm run test:memory`. Rollback: remove only these additive schemas, validators, and
  their focused assertions.
- [x] 1.2 Implement feedback and report contracts. Owned paths:
  `schemas/memory-feedback.schema.json`,
  `schemas/memory-paired-report.schema.json`, `src/memory/contracts.mjs`, and
  `src/memory/index.mjs`. Evidence: feedback requires at least one evidence reference,
  has no `source`, validates ID prefixes and selected-memory membership, and report
  validation covers comparison status, matched controls, arm result status, canonical
  deltas, retained session/workspace IDs, cross-arm execution uniqueness, and
  cross-field utilization invariants documented by Schema `$comment`. Verification:
  `npm run test:memory`. Rollback: revert only these additive schemas, exports,
  validators, and focused assertions.

## 2. Paired comparison

- [x] 2.1 Implement strict pair validation and deterministic arm assignment. Owned
  paths: `src/memory/paired-comparison.mjs` and `tests/memory/run.mjs`. Evidence:
  reverse-order inputs yield the same report; missing evidence, same arms, control
  mismatch, policy mismatch, duplicate IDs, malformed input, foreign feedback
  evidence, shared arm evidence, missing execution, reused sessions, and reused
  workspaces are rejected. Execution IDs are bounded to 1–128 characters.
  Verification: `npm run test:memory`. Rollback: remove the isolated comparison
  module and focused tests.
- [x] 2.2 Implement feedback counts, utilization, and `quality`/`time`/`cost` deltas.
  Owned paths: `src/memory/paired-comparison.mjs` and `tests/memory/fixtures/*.json`.
  Evidence: helpful/harmful counts and utilization are derived from feedback;
  a failed arm makes the comparison ineligible and all deltas unavailable; missing
  cost on an eligible comparison is unavailable, never estimated. Verification:
  `npm run test:memory`. Rollback: revert only aggregation code and its fixtures.

## 3. Backup Case

- [x] 3.1 Add the deterministic `memory-effectiveness-smoke` backup Case and
  evaluator. Owned paths: `cases/memory-effectiveness-smoke/**`,
  `src/evaluators/cases/memory-effectiveness-smoke/**`, and the corresponding
  `src/control-plane/case-registry.mjs` entry. Evidence: approved memory avoids the
  semantic-version trap, the off arm reproduces it, and `PRIMARY_CASES` is unchanged.
  The formal Golden pipeline completes with control-plane-attested evidence.
  Verification: `npm run test:memory && npm run validate:structure`. Rollback: remove
  only the Case, evaluator, and its backup registry entry.

## 4. CLI and documentation

- [x] 4.1 Add atomic structured report generation. Owned paths:
  `scripts/bench.mjs`, the `bench:memory-report` entry in `package.json`, and focused
  CLI assertions in `tests/memory/run.mjs`. Evidence: valid inputs produce a
  schema-valid report through exclusive `linkSync(temp, out)` publication; two
  concurrent publishers yield exactly one success; invalid input, input alias, or
  existing output exits nonzero without mutation; `finally` removes every temp file.
  Verification: `npm run test:memory`. Rollback: remove only the subcommand, package
  alias, and focused CLI assertions.
- [x] 4.2 Document the pair contract, backup Case, command, rejection behavior, and
  zero-charge test path. Owned paths: the memory-effectiveness sections in
  `README.md` and `docs/operations/RUNBOOK.md`. Evidence: examples use the actual
  `memory-report` arguments and report fields. Verification:
  `git diff --check -- README.md docs/operations/RUNBOOK.md`. Rollback: remove only
  those appended sections.

## 5. Integration verification

- [x] 5.1 Integrate deterministic memory checks into the default test gate. Owned
  paths: `tests/memory/**` and the `test:memory` entries in `package.json`. Evidence:
  contract, comparison, backup Case, report, CLI success/failure, and no-external-model
  behavior execute from fixtures; the focused gate reports 16/16 checks passed.
  Verification:
  `npm run test:memory && npm test`. Rollback: remove only the focused test script and
  its package entries.
- [x] 5.2 Validate the OpenSpec change and repository diff. Owned paths:
  `openspec/config.yaml` and
  `openspec/changes/memory-effectiveness-benchmark/**`. Evidence: strict validation
  passes with all requirements and scenarios. Verification:
  `/Users/leozhou/git/agent-os/node_modules/.bin/openspec validate --strict --all`
  and `git diff --check`. Rollback: revise only this change's specification files.
