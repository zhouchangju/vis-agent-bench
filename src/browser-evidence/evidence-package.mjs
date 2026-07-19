import { structuredError, isStructuredError } from './errors.mjs';

const SCHEMA_VERSION = 1;
const ALLOWED_FAILURE_CODES = new Set([
  'LOAD_FAILED', 'SELECTOR_MISSING', 'ACTION_TIMEOUT', 'ASSERT_FAILED',
  'NETWORK_FAILURE', 'PAGE_ERROR', 'CAPTURE_INCOMPLETE', 'DRIVER_UNAVAILABLE',
  'SPEC_INVALID', 'IO_ERROR',
]);

function diagnostic(path, code, message) {
  return { path, code, message };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that an evidence package produced by a driver has the shape the
 * review UI and the evaluator rely on. This is intentionally narrower than
 * a full JSON Schema; it enforces the contract every driver must obey.
 */
export function validateEvidencePackage(pkg) {
  const errors = [];
  if (!isObject(pkg)) return { valid: false, errors: [diagnostic('$', 'OBJECT', 'Evidence package must be an object.')], package: null };
  const required = [
    'schema_version', 'capture_id', 'run_id', 'case_id', 'driver', 'captured_at',
    'duration_ms', 'page_url', 'viewport', 'wait', 'screenshots', 'dom_snapshots',
    'console_errors', 'page_errors', 'network_events', 'action_log', 'failures', 'status',
  ];
  for (const field of required) {
    if (!Object.hasOwn(pkg, field)) errors.push(diagnostic(`$.${field}`, 'REQUIRED', `${field} is required.`));
  }
  if (pkg.schema_version !== SCHEMA_VERSION) errors.push(diagnostic('$.schema_version', 'CONST', `schema_version must be ${SCHEMA_VERSION}.`));
  for (const field of ['capture_id', 'run_id', 'case_id', 'driver']) {
    if (!isNonEmptyString(pkg[field])) errors.push(diagnostic(`$.${field}`, 'STRING', `${field} must be non-empty.`));
  }
  if (!['success', 'warning', 'error'].includes(pkg.status)) {
    errors.push(diagnostic('$.status', 'ENUM', 'status must be success, warning or error.'));
  }
  if (!Array.isArray(pkg.failures)) {
    errors.push(diagnostic('$.failures', 'ARRAY', 'failures must be an array of structured errors.'));
  } else {
    pkg.failures.forEach((failure, index) => {
      const path = `$.failures[${index}]`;
      if (!isObject(failure) || typeof failure.code !== 'string' || typeof failure.message !== 'string') {
        errors.push(diagnostic(path, 'STRUCTURED_ERROR', 'Each failure must be a structured error object with code and message.'));
        return;
      }
      if (!ALLOWED_FAILURE_CODES.has(failure.code)) {
        errors.push(diagnostic(`${path}.code`, 'ENUM', `Unknown failure code: ${failure.code}`));
      }
    });
  }
  if (pkg.status === 'error' && !pkg.failures.some(f => f.code === 'LOAD_FAILED' || f.code === 'CAPTURE_INCOMPLETE' || f.code === 'DRIVER_UNAVAILABLE' || f.code === 'IO_ERROR')) {
    errors.push(diagnostic('$.failures', 'STATUS_FAILURE_MISMATCH', 'error status requires a load/capture/driver/io failure.'));
  }
  for (const field of ['screenshots', 'dom_snapshots', 'console_errors', 'page_errors', 'network_events', 'action_log']) {
    if (pkg[field] != null && !Array.isArray(pkg[field])) {
      errors.push(diagnostic(`$.${field}`, 'ARRAY', `${field} must be an array.`));
    }
  }
  if (errors.length) return { valid: false, errors, package: null };
  return { valid: true, errors: [], package: pkg };
}

/**
 * Fields the review UI exposes when reviewers should NOT learn the model
 * identity (blind review). Everything else stays available. The list is
 * intentionally narrow so the reviewer keeps full evidence context.
 */
export const BLIND_REVIEW_HIDDEN_FIELDS = [
  'driver',
  'user_agent',
];

/**
 * Return a shallow copy of the package with blind-review sensitive fields
 * redacted. The redaction is reversible only by re-reading the original
 * package; no model identity is leaked by the returned object.
 */
export function redactForBlindReview(pkg) {
  if (!isObject(pkg)) return pkg;
  const next = { ...pkg };
  for (const field of BLIND_REVIEW_HIDDEN_FIELDS) {
    if (field in next) next[field] = '[blind:review]';
  }
  if (Array.isArray(next.notes)) {
    next.notes = next.notes.map(note => typeof note === 'string' ? note.replace(/driver=[^\s;]+/gi, 'driver=[blind:review]') : note);
  }
  return next;
}
