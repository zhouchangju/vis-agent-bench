## ADDED Requirements

### Requirement: Produce the canonical structured paired report

The system SHALL produce a camelCase `MemoryPairedReport` with
`schemaVersion: 1`, experiment/project/task identifiers, `comparisonStatus`,
`armControls`, `arms`, `controls`, `feedbackCounts`, `utilization`, `deltas`,
`evidenceRefs`, and `generatedAt`.

`arms` SHALL contain exactly `off` and `approved_only`, each with
`interventionId`, `retrievalRunId`, `contextPackHash`, `selectedMemoryIds`, and
`resultStatus`, `sessionId`, and `workspaceId`. Session/workspace values SHALL satisfy
the bounded-ID shape, and the authoritative runtime validator SHALL require distinct
values across arms. The report Schema SHALL use `$comment` to declare this cross-arm
invariant. `controls` SHALL equal the validated shared experiment controls;
`armControls` SHALL contain every control field with value `matched`.
`comparisonStatus` SHALL be `eligible` exactly when both result statuses are
`success`, otherwise `ineligible`. `deltas` SHALL contain exactly `quality`, `time`,
and `cost`. `evidenceRefs` SHALL contain independent evidence from both arm results
plus validated same-arm feedback evidence.

#### Scenario: Build a valid paired report

- **WHEN** valid, controlled, independently evidenced off and approved-only inputs are
  supplied
- **THEN** the system returns a schema-valid report with both arm traces
- **AND** copies the shared controls and records every arm control as matched
- **AND** records each arm result status, session/workspace identity, and comparison
  eligibility
- **AND** aggregates feedback, utilization, deltas, and evidence references.

#### Scenario: Reject report execution reuse

- **WHEN** a report contains equal session IDs or equal workspace IDs across arms
- **THEN** the authoritative runtime validator rejects it
- **AND** identifies session reuse or workspace reuse.

### Requirement: Preserve missing metric values as unavailable

For a valid pair, a delta whose metric is absent from either arm SHALL have
`availability=unavailable`, `value=null`, its unit, and a machine-readable reason.
The system SHALL NOT estimate missing quality, duration, or cost.
If either arm failed, the comparison SHALL be ineligible and all three deltas SHALL
be unavailable regardless of any numeric values left by that failed run.

#### Scenario: Preserve missing cost

- **WHEN** at least one valid arm has `costUsd=null`
- **THEN** `deltas.cost` is unavailable with a null value and reason
- **AND** available quality or time deltas remain reported.

#### Scenario: Suppress every delta after arm failure

- **WHEN** either valid arm has `resultStatus=failed`
- **THEN** `comparisonStatus` is ineligible
- **AND** quality, time, and cost deltas are all unavailable.

### Requirement: Generate the report atomically through the CLI

The CLI SHALL support:

```text
node scripts/bench.mjs memory-report \
  --off <off-run.json> \
  --approved-only <approved-only-run.json> \
  --out <paired-report.json>
```

It SHALL validate both inputs and all pair invariants before writing. It SHALL
exclusively create a unique sibling temporary file and atomically publish it with
`linkSync(temp, out)`, which fails if the output was created concurrently. It SHALL
reject an output that aliases either input or already exists. A `finally` cleanup
SHALL unlink the temporary file on success or failure. On success it SHALL return the
output path in the structured result envelope. On invalid input it SHALL exit nonzero
and leave no partial report.

#### Scenario: Atomically write a valid report

- **WHEN** the command receives valid arm files and a writable output path
- **THEN** it writes one complete schema-valid report via exclusive hard-link publish
- **AND** returns the report path as an artifact.

#### Scenario: Reject invalid input without partial output

- **WHEN** the approved-only input has a null Context Pack hash
- **THEN** the command exits nonzero with a contract error
- **AND** leaves no output report.

#### Scenario: Preserve inputs and an existing output

- **WHEN** the requested output aliases an input or names any existing file
- **THEN** the command exits nonzero
- **AND** does not modify the inputs or existing output
- **AND** removes any temporary file it created.

#### Scenario: Resolve concurrent publishers without clobbering

- **WHEN** two valid CLI processes concurrently target the same absent output path
- **THEN** exactly one exclusive hard-link publish succeeds
- **AND** the other exits nonzero without replacing the winning report
- **AND** neither process leaves a temporary file.

### Requirement: Keep automated verification zero-charge

Contract, comparison, backup-Case, report, and CLI tests SHALL use deterministic
fixtures and SHALL NOT invoke an external model CLI or API.

#### Scenario: Run focused memory verification

- **WHEN** CI executes `npm run test:memory`
- **THEN** all memory-effectiveness paths execute from local fixtures
- **AND** no external model usage or charge occurs.
