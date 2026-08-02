## ADDED Requirements

### Requirement: Describe the canonical controlled experiment

The system SHALL validate a camelCase `MemoryExperimentSpec` with exactly these
top-level fields: `schemaVersion: 1`, non-empty `experimentId`, `projectId`, and
`taskId`, `arms`, `controls`, and canonical RFC3339 `createdAt`. Every timestamp SHALL
use a nonzero four-digit year, uppercase `T`, uppercase `Z` or a numeric `±HH:MM`
offset, hour `00`–`23`, minute `00`–`59`, and second `00`–`59`; leap seconds SHALL be
rejected. Schema patterns SHALL enforce the lexical subset and use `$comment` to state
that runtime additionally validates the real Gregorian calendar date. `arms` SHALL be
exactly
the ordered array `["off", "approved_only"]`.

`controls` SHALL contain non-empty `caseId`, `caseVersion`, `model`, `provider`, and
`engine`; `reasoningEffort` as a non-empty string or null; unique non-empty string
`tools`; `budget`; `baseCommit`; `fixtureHash`; and `memorySnapshotHash`. The budget
SHALL require positive `wallTimeMinutes`, nonnegative integer `maxRetries`,
`maxTokens` as null or a positive integer, and `maxCostUsd` as null or a nonnegative
number. `baseCommit` SHALL be 7–64 hexadecimal characters; `fixtureHash` and
`memorySnapshotHash` SHALL be lowercase SHA-256 hexadecimal.

#### Scenario: Accept a canonical controlled experiment

- **WHEN** an operator supplies every canonical field, the exact ordered arms, and
  controls satisfying their type and range constraints
- **THEN** the system accepts the experiment specification.

#### Scenario: Reject an altered arm set

- **WHEN** an experiment omits, duplicates, adds, or reorders an arm
- **THEN** the system rejects the specification
- **AND** reports that arms must be exactly `["off", "approved_only"]`.

#### Scenario: Reject an impossible calendar date

- **WHEN** a contract timestamp is `2026-02-30T00:00:00Z`
- **THEN** the authoritative runtime validator rejects it
- **AND** does not rely on permissive host date normalization.

#### Scenario: Reject a non-canonical timestamp

- **WHEN** a timestamp uses lowercase `t` or `z`, year `0000`, hour `24`, or leap
  second `60`
- **THEN** Schema or the authoritative runtime validator rejects it
- **AND** persists no contract artifact.

### Requirement: Record a traceable memory intervention

Each camelCase `MemoryIntervention` SHALL require `schemaVersion: 1`,
`interventionId`, `retrievalRunId`, experiment/project/task identifiers, `arm`,
`policyVersion`, `contextPackHash`, `selectedMemoryIds`, and `createdAt`.
`interventionId` SHALL start with `memory_intervention_`, `retrievalRunId` with
`memory_retrieval_`, and every selected memory ID with `memory_`.

For `arm=off`, `contextPackHash` SHALL be null and `selectedMemoryIds` SHALL be empty.
For `arm=approved_only`, `contextPackHash` SHALL be lowercase SHA-256 hexadecimal even
when no memory matches, and `selectedMemoryIds` SHALL contain at most three unique
non-empty IDs.

#### Scenario: Record the off arm

- **WHEN** retrieval is disabled for the control arm
- **THEN** the intervention retains its non-empty `retrievalRunId`
- **AND** records `contextPackHash=null`
- **AND** records `selectedMemoryIds=[]`.

#### Scenario: Record an approved-only zero-match pack

- **WHEN** approved-only retrieval completes without a matching memory
- **THEN** the intervention records an empty `selectedMemoryIds`
- **AND** records the lowercase SHA-256 hash of the empty Context Pack.

### Requirement: Bind feedback to evidence and the delivered intervention

Each camelCase `MemoryFeedback` SHALL require `schemaVersion: 1`, `feedbackId`,
`interventionId`, nullable `memoryId`, `outcome`, at least one unique non-empty
`evidenceRefs` entry, string `note`, and canonical RFC3339 `createdAt`. It SHALL NOT
contain a `source` field. `feedbackId` SHALL start with `memory_feedback_`,
`interventionId` with `memory_intervention_`, non-null `memoryId` with `memory_`, and
every evidence reference with `run_` or `artifact_`.

A non-null `memoryId` SHALL belong to the referenced intervention's
`selectedMemoryIds`. A null `memoryId` SHALL denote intervention-level feedback. For
pairing, every feedback evidence reference SHALL also belong to the same arm's
`result.evidenceRefs`.

#### Scenario: Accept intervention-level feedback

- **WHEN** feedback references a valid intervention, has `memoryId=null`, and includes
  at least one correctly prefixed evidence reference owned by the same arm result
- **THEN** the system accepts it as intervention-level feedback.

#### Scenario: Reject unselected or unsupported feedback

- **WHEN** feedback names an unselected memory, uses an invalid ID prefix, omits
  evidence, cites evidence outside its arm result, or includes a `source` field
- **THEN** the system rejects the feedback
- **AND** excludes it from paired aggregation.
