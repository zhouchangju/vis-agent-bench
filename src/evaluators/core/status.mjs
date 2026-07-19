// Evaluator Core status semantics.
//
// Every check resolves to exactly one of these statuses. Status names are
// machine-readable identifiers; do not mutate them without bumping the
// evaluator protocol version.

export const STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  WARNING: 'warning',
  SKIPPED: 'skipped',
  ERROR: 'error',
});

const STATUS_VALUES = new Set(Object.values(STATUS));

export function isStatus(value) {
  return typeof value === 'string' && STATUS_VALUES.has(value);
}

// Statuses that count as "ran". Anything outside this set means the check
// did not produce a usable result (missing evidence, never scheduled, or
// the evaluator itself blew up before invoking the assertion).
export const EXECUTED_STATUSES = Object.freeze(new Set([
  STATUS.PASS,
  STATUS.FAIL,
  STATUS.WARNING,
]));

// Statuses that originate in the evaluator harness, not in the system under
// test. They must never be mixed with project failures when summarising a
// rubric.
export const HARNESS_STATUSES = Object.freeze(new Set([
  STATUS.SKIPPED,
  STATUS.ERROR,
]));

export function isExecuted(status) {
  return EXECUTED_STATUSES.has(status);
}

export function isHarnessStatus(status) {
  return HARNESS_STATUSES.has(status);
}

// Crisp predicates used by scoring and reporting. Kept explicit so unit
// tests can express intent instead of comparing strings.
export function isPassing(status) {
  return status === STATUS.PASS || status === STATUS.WARNING;
}

export function isBlocking(status) {
  return status === STATUS.FAIL;
}

export function isHarnessFault(status) {
  return status === STATUS.ERROR;
}

export function describeStatus(status) {
  switch (status) {
    case STATUS.PASS: return 'check passed; assertion held';
    case STATUS.FAIL: return 'system under test failed the assertion';
    case STATUS.WARNING: return 'soft signal; assertion held but with caveats';
    case STATUS.SKIPPED: return 'evaluator skipped this check (preconditions missing)';
    case STATUS.ERROR: return 'evaluator harness crashed before completing the assertion';
    default: return 'unknown status';
  }
}
