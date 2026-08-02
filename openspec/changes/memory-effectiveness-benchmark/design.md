# Design: memory-effectiveness-benchmark

## Context

Memory effectiveness is a controlled comparison, not a single-run score. Each input
arm is a JSON object containing `experimentSpec`, `execution`, `intervention`,
`feedback`, and `result`. `execution` contains only bounded `sessionId` and
`workspaceId` values. The benchmark validates runtime-owned intervention evidence and
derives a paired report; it does not reconstruct retrieval decisions.

## Data Flow

```text
off run JSON ───────────┐
                       ├─ validate pair ─ aggregate ─ exclusive hard-link publish ─ report JSON
approved_only run JSON ─┘
```

## Decisions

### DEC-1: Canonical `MemoryExperimentSpec` is minimal and exact

The spec requires `schemaVersion`, `experimentId`, `projectId`, `taskId`, exact arms
`["off", "approved_only"]`, `controls`, and `createdAt`.

`controls` requires:

- non-empty `caseId`, `caseVersion`, `model`, `provider`, and `engine`;
- `reasoningEffort` as a non-empty string or `null`;
- unique string `tools`;
- `budget.wallTimeMinutes` positive, `maxRetries` nonnegative,
  `maxTokens` null or a positive integer, and `maxCostUsd` null or nonnegative;
- `baseCommit` as 7–64 hexadecimal characters;
- `fixtureHash` and `memorySnapshotHash` as lowercase SHA-256 hexadecimal.

All contract timestamps use one canonical RFC3339 subset: a nonzero four-digit year,
uppercase `T`, uppercase `Z` or a numeric `±HH:MM` offset, and seconds from `00` to
`59` (leap seconds are rejected). Hours are limited to `00`–`23`. Schema patterns
enforce this lexical form; `$comment` records that the authoritative runtime validator
also checks the real Gregorian day for the selected month and year.

### DEC-2: Disabled retrieval and an empty Context Pack remain distinct

Every `MemoryIntervention` requires `retrievalRunId`. For the `off` arm,
`contextPackHash` is `null` and `selectedMemoryIds` is empty. For
`approved_only`, the Context Pack hash is lowercase SHA-256 even when no memory
matches, and at most three unique memory IDs may be selected. IDs use stable
namespaces: `memory_intervention_…`, `memory_retrieval_…`, and `memory_…`.

### DEC-3: Feedback is evidence-bound and source-free

`MemoryFeedback` requires `feedbackId`, `interventionId`, nullable `memoryId`,
`outcome`, at least one unique `evidenceRefs` entry, `note`, and `createdAt`. It has
no `source` field. A non-null `memoryId` must belong to the referenced
intervention's `selectedMemoryIds`; null means intervention-level feedback.
Feedback IDs use `memory_feedback_…`; evidence references use `run_…` or
`artifact_…` and every feedback reference must also appear in the same arm's
`result.evidenceRefs`.

### DEC-4: Invalid pairs fail closed

The comparator rejects:

- malformed experiments, interventions, feedback, results, or missing result evidence;
- two inputs declaring the same arm;
- different experiment/project/task identifiers;
- unequal controls or retrieval `policyVersion`;
- duplicate intervention/retrieval/feedback IDs across arms;
- missing or malformed execution identity;
- reused `sessionId` or `workspaceId`;
- any result evidence reference reused by both arms;
- feedback evidence absent from its own arm result.

Input order does not determine arm identity. Pair rejection produces no report.

### DEC-5: Arm eligibility controls delta availability

A valid report contains `schemaVersion`, experiment/project/task identifiers,
`comparisonStatus`, `armControls`, `arms`, `controls`, `feedbackCounts`,
`utilization`, `deltas`, `evidenceRefs`, and `generatedAt`. Every accepted control is
recorded as `matched`; each arm records `resultStatus=success|failed`.
Each report arm also retains its bounded `sessionId` and `workspaceId`. The
authoritative runtime validator requires both values to be distinct across arms;
Schema records this non-local invariant in `$comment`.

`deltas` contains exactly `quality`, `time`, and `cost`, calculated as
`approved_only_minus_off`. Two successful arms make the comparison `eligible`; if
either arm failed it becomes `ineligible` and all three deltas are unavailable. For
an eligible comparison, a missing numeric metric makes only that delta unavailable.
A zero-match approved arm also has unavailable utilization because no selected-memory
denominator exists. The authoritative runtime validator also requires
`selectedCount` to equal the approved arm's selected-ID count, `observedCount` not to
exceed it, and a reported `rate` to equal their ratio rounded to six decimals. JSON
Schema records these non-local invariants in `$comment`; it cannot enforce them alone.

### DEC-6: Report generation is deterministic and atomic

The CLI validates both inputs before writing. It exclusively creates a unique sibling
temporary file, then uses `linkSync(temp, out)` as the atomic, no-clobber publish
primitive. A concurrent publisher can therefore never replace the first complete
output between a preflight check and publish. It refuses an output path that aliases
either input or already exists, and its `finally` cleanup unlinks the temporary file
on both success and failure. Source inputs are read-only.

### DEC-7: Backup verification is zero-charge

`memory-effectiveness-smoke` is registered as a backup Case, not a primary Case. Its
semantic-version trap, approved-memory fixture, and evaluator are deterministic.
`test:memory` proves it completes the formal Golden pipeline with
`evidence_trust.mode=control-plane-attested`, without invoking an external model CLI
or API.

## Trust Boundaries

- `agent-os` owns retrieval and Context Pack construction.
- Arm JSON is untrusted until all schema and cross-document checks pass.
- Session and workspace IDs prove comparison isolation boundaries; they are not
  authorization tokens, and reuse invalidates the pair.
- Feedback is auditable evidence, not ground truth.
- Shared result evidence is treated as cross-arm contamination and rejected.
- The CLI may write only the requested report artifact.

## Persistence and Recovery

Both arm files remain immutable inputs. The paired report is reproducible derived
evidence. After a validation or write failure, fix or regenerate the affected arm and
rerun the CLI; no source-run rollback is needed.

## Rejected Alternatives

- Historical baseline instead of paired arms: it confounds inputs and runtime.
- Empty approved retrieval represented as `off`: it erases retrieval evidence.
- Missing evidence represented as an unavailable pair: it weakens causal validity.
- Missing metrics coerced to zero: it creates false deltas.
- Arbitrary feedback memory IDs: it breaks intervention attribution.
- Reporting command launching models: it mixes aggregation with billing risk.
