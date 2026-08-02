## ADDED Requirements

### Requirement: Accept only an independently evidenced controlled pair

The system SHALL pair exactly one valid `off` run with one valid `approved_only` run,
independent of input order. Experiment, project, and task identifiers SHALL match.
The complete `controls` objects and intervention `policyVersion` values SHALL match.
Each result SHALL contain at least one non-empty evidence reference, and result
evidence references SHALL be independent across arms.
Each run wrapper SHALL contain exactly one `execution` object with `sessionId` and
`workspaceId`. Both values SHALL be 1–128 character bounded identifiers matching
`^[A-Za-z0-9][A-Za-z0-9._:-]*$`. The two arms SHALL have distinct session IDs to
prove fresh sessions and distinct workspace IDs to prove independent workspaces.
Intervention and retrieval-run identifiers SHALL be distinct across arms, and
feedback identifiers SHALL be unique across the complete pair. Every feedback
evidence reference SHALL appear in its own arm's result evidence set.

The system SHALL reject malformed inputs, missing evidence, same-arm inputs,
identifier mismatch or collision, control mismatch, policy mismatch, feedback
evidence owned by another arm, shared result evidence, missing/malformed execution,
session reuse, or workspace reuse. Rejection SHALL produce no paired report.

#### Scenario: Pair reverse-ordered valid arms

- **WHEN** approved-only input is supplied before a matching off input
- **THEN** the system assigns both runs by declared arm
- **AND** produces the same report as the reverse input order.

#### Scenario: Reject a control mismatch

- **WHEN** the two arms differ in any canonical control value
- **THEN** the system rejects the pair
- **AND** writes no paired report.

#### Scenario: Reject cross-arm evidence contamination

- **WHEN** both arm results reuse any evidence reference or feedback cites evidence
  outside its own arm result
- **THEN** the system rejects the pair as contaminated
- **AND** does not calculate deltas.

#### Scenario: Reject reused execution state

- **WHEN** two otherwise valid arms share a `sessionId` or a `workspaceId`
- **THEN** the system rejects the pair
- **AND** reports session reuse or workspace reuse
- **AND** writes no paired report.

### Requirement: Aggregate only validated feedback and metrics

For a valid pair, the system SHALL count feedback outcomes as `helpful`, `neutral`,
`harmful`, and `unobserved`. It SHALL calculate selected-memory utilization from
observed, non-unobserved, memory-level approved-arm feedback.

It SHALL calculate `quality`, `time`, and `cost` deltas as
`approved_only_minus_off`. When both arms have `result.status=success`, the comparison
SHALL be `eligible`; if either status is `failed`, it SHALL be `ineligible` and all
three deltas SHALL be unavailable. For an eligible pair, when either arm lacks the
numeric value for a metric, only that delta SHALL be `unavailable` with null value and
a reason. When approved retrieval selects no memories, utilization SHALL be
unavailable with a zero denominator and reason.

The authoritative runtime report validator SHALL require utilization
`selectedCount` to equal the approved arm's `selectedMemoryIds.length`,
`observedCount <= selectedCount`, and a reported `rate` to equal
`observedCount / selectedCount` rounded to six decimals. The report Schema SHALL use
`$comment` to declare these cross-field checks.

#### Scenario: Report available quality and unavailable cost

- **WHEN** both arms provide quality scores but either arm has `costUsd=null`
- **THEN** the report contains the numeric approved-only-minus-off quality delta
- **AND** marks only the cost delta unavailable.

#### Scenario: Report zero-match utilization

- **WHEN** an approved-only intervention has a valid empty Context Pack and no
  selected memories
- **THEN** the report records zero selected and observed memories
- **AND** marks utilization unavailable because no denominator exists.

#### Scenario: Reject inconsistent utilization

- **WHEN** a report's selected count differs from the approved arm selection, its
  observed count exceeds selected count, or its rate is not the derived ratio
- **THEN** the authoritative runtime validator rejects the report
- **AND** identifies a utilization mismatch.

#### Scenario: Mark a failed-arm comparison ineligible

- **WHEN** either arm has `result.status=failed`
- **THEN** the report records `comparisonStatus=ineligible`
- **AND** preserves both arm result statuses and feedback counts
- **AND** marks quality, time, and cost deltas unavailable.

### Requirement: Keep the backup Case deterministic and non-primary

The benchmark SHALL register `memory-effectiveness-smoke` as a backup Case without
changing `PRIMARY_CASES`. Its semantic-version fixture and evaluator SHALL be
deterministic and SHALL require no network, secret, external model CLI, or model API.
The Case SHALL complete the formal Golden pipeline with control-plane-attested
evidence.

#### Scenario: Verify the historical trap at zero model cost

- **WHEN** `test:memory` evaluates the backup Case fixtures
- **THEN** the off fixture reproduces the lexical semantic-version trap
- **AND** the approved fixture avoids it using the selected memory trace
- **AND** the Golden result records `evidence_trust.mode=control-plane-attested`
- **AND** no external model process is invoked.
