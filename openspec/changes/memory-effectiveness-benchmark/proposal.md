# Change: memory-effectiveness-benchmark

## Why

`vis-agent-bench` can evaluate individual agent runs, but it cannot yet attribute a
quality, time, or cost change to approved project-memory injection. A reproducible
comparison needs stable shared contracts, exactly two controlled arms, independent
evidence, and deterministic reporting.

Without that boundary, `agent-os` and the benchmark can disagree about empty Context
Packs, selected-memory membership, controls, or missing metrics. The resulting delta
would not support a causal claim.

## User-observable Outcome

- Four camelCase JSON contracts with `schemaVersion: 1` define the experiment,
  intervention, feedback, and paired report.
- A pair contains arms exactly `["off", "approved_only"]`.
- Invalid, same-arm, control-drifted, policy-drifted, evidence-missing, or
  cross-contaminated pairs are rejected. Missing execution identity, reused sessions,
  or reused workspaces are also rejected.
- Valid pairs report `comparisonStatus`, per-field `armControls`, arm result status,
  per-arm session/workspace identity, feedback counts, utilization, and
  `quality`/`time`/`cost` deltas. A failed arm makes the comparison `ineligible` and
  all three deltas unavailable; a metric missing from an otherwise eligible pair
  makes only that delta unavailable.
- Operators can atomically generate the JSON report with:

  ```bash
  node scripts/bench.mjs memory-report \
    --off <off-run.json> \
    --approved-only <approved-only-run.json> \
    --out <paired-report.json>
  ```

- `memory-effectiveness-smoke` is a deterministic backup Case verified through the
  formal control-plane-attested Golden pipeline at zero model cost.

## Capabilities

### Added Capabilities

- `memory-experiment-contracts`: canonical experiment, intervention, feedback, and
  report schemas and validators.
- `paired-memory-comparison`: strict pair validation, contamination prevention, and
  deterministic aggregation.
- `memory-effectiveness-reporting`: atomic CLI report generation and zero-charge
  backup-Case verification.

## Directional Guardrails

- The benchmark consumes approved-memory interventions; it does not create, approve,
  rank, or mutate memories.
- Experiment controls are exact and shared by both arms: Case identity/version,
  model, provider, engine, reasoning effort, tools, budget, base commit, fixture hash,
  and memory-snapshot hash.
- Result and feedback evidence must be explicit. The comparator rejects invalid pair
  evidence, requires feedback evidence to belong to its arm result, and rejects
  cross-arm contamination.
- Arms use fresh sessions and independent workspaces; shared execution state is not a
  valid memory-effectiveness comparison.
- Automated tests use deterministic fixtures and do not invoke external models.
- The JSON report is additive and does not replace existing Run or evaluator reports.

## Explicitly Out of Scope

- Memory extraction, retrieval ranking, consolidation, or lifecycle storage.
- Vector retrieval, GraphRAG, or scorer training.
- Paired-run orchestration or automatic external-model execution.
- HTML/Markdown projections, dashboards, leaderboards, or human-review workflows.

## Impact

- Schemas: `schemas/memory-*.schema.json`.
- Runtime: `src/memory/`.
- CLI: `scripts/bench.mjs` and `bench:memory-report`.
- Backup Case: `cases/memory-effectiveness-smoke/` and its deterministic evaluator.
- Tests: `tests/memory/` and the `test:memory` gate.
- Existing contracts and primary Case membership remain unchanged.
