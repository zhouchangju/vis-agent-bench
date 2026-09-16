import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builder + validator for human-review.json.
 *
 * Mirrors `schemas/human-review.schema.json` at schema_version 2. The
 * validator is intentionally stricter than the JSON Schema file: it enforces
 * the same rules but returns structured diagnostics the review UI and tests
 * can branch on.
 */

// Mirrored by schemas/human-review.schema.json (required fields); tests/contracts
// asserts the two stay in sync.
export const HUMAN_REVIEW_REQUIRED_TOP = ['schema_version', 'run_id', 'reviewer', 'isolation', 'reviews', 'reviewed_at'];
export const HUMAN_REVIEW_REVIEW_REQUIRED = ['case_id', 'complete', 'decision', 'scores', 'human_time', 'convergence', 'observations'];
const REQUIRED_TOP = HUMAN_REVIEW_REQUIRED_TOP;
const DECISIONS = new Set(['accepted', 'accepted-with-fixes', 'partial', 'rejected', 'invalid-run', null]);
const SCORE_KEYS = ['business', 'visual', 'interaction', 'usability'];
const HUMAN_TIME_KEYS = [
  'clarification_minutes', 'context_prep_minutes', 'poc_review_minutes',
  'micro_adjustment_minutes', 'fix_minutes', 'final_review_minutes',
];
const CONVERGENCE_KEYS = [
  'clarification_rounds', 'iterations_to_acceptance', 'micro_adjustment_items',
  'must_have_misses', 'requirement_regressions', 'first_poc_fitness_percent',
];
const OBSERVATION_KEYS = ['strengths', 'problems', 'required_fixes', 'management_judgment'];

function diagnostic(path, code, message) {
  return { path, code, message };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function assertNoExtra(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(diagnostic(`${path}.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed by this contract.'));
  }
}

function validateScores(value, path, errors) {
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'scores must be an object.'));
    return;
  }
  assertNoExtra(value, new Set(SCORE_KEYS), path, errors);
  for (const key of SCORE_KEYS) {
    if (!(key in value)) {
      errors.push(diagnostic(`${path}.${key}`, 'REQUIRED', `scores.${key} is required (null allowed).`));
      continue;
    }
    const v = value[key];
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5)) {
      errors.push(diagnostic(`${path}.${key}`, 'SCORE_RANGE', `scores.${key} must be an integer 1-5 or null.`));
    }
  }
}

function validateHumanTime(value, path, errors) {
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'human_time must be an object.'));
    return;
  }
  assertNoExtra(value, new Set(HUMAN_TIME_KEYS), path, errors);
  for (const key of HUMAN_TIME_KEYS) {
    if (!(key in value)) {
      errors.push(diagnostic(`${path}.${key}`, 'REQUIRED', `human_time.${key} is required.`));
      continue;
    }
    if (!isNonNegInt(value[key])) {
      errors.push(diagnostic(`${path}.${key}`, 'NON_NEGATIVE_INT', `human_time.${key} must be a non-negative integer.`));
    }
  }
}

function validateConvergence(value, path, errors) {
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'convergence must be an object.'));
    return;
  }
  assertNoExtra(value, new Set(CONVERGENCE_KEYS), path, errors);
  for (const key of CONVERGENCE_KEYS) {
    if (!(key in value)) {
      errors.push(diagnostic(`${path}.${key}`, 'REQUIRED', `convergence.${key} is required.`));
      continue;
    }
    const v = value[key];
    const max = key === 'first_poc_fitness_percent' ? 100 : Infinity;
    if (!isNonNegInt(v) || v > max) {
      errors.push(diagnostic(`${path}.${key}`, 'NON_NEGATIVE_INT', `convergence.${key} must be a non-negative integer${key === 'first_poc_fitness_percent' ? ' ≤ 100' : ''}.`));
    }
  }
}

function validateObservations(value, path, errors) {
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'observations must be an object.'));
    return;
  }
  assertNoExtra(value, new Set(OBSERVATION_KEYS), path, errors);
  for (const key of OBSERVATION_KEYS) {
    if (!(key in value)) {
      errors.push(diagnostic(`${path}.${key}`, 'REQUIRED', `observations.${key} is required.`));
      continue;
    }
    if (typeof value[key] !== 'string') {
      errors.push(diagnostic(`${path}.${key}`, 'STRING', `observations.${key} must be a string.`));
    }
  }
}

function validateMachineEvidence(value, path, errors) {
  if (value == null) return;
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'machine_evidence must be an object or null.'));
    return;
  }
  assertNoExtra(value, new Set(['run_id', 'capture_id', 'captured_at']), path, errors);
  for (const key of ['run_id', 'capture_id', 'captured_at']) {
    if (!isNonEmptyString(value[key])) {
      errors.push(diagnostic(`${path}.${key}`, 'STRING', `machine_evidence.${key} must be a non-empty string.`));
    }
  }
}

function validateReview(review, index, errors) {
  const path = `reviews[${index}]`;
  if (!isObject(review)) {
    errors.push(diagnostic(path, 'OBJECT', 'Review entry must be an object.'));
    return;
  }
  const allowed = new Set([...HUMAN_REVIEW_REVIEW_REQUIRED, 'machine_evidence']);
  assertNoExtra(review, allowed, path, errors);
  for (const field of HUMAN_REVIEW_REVIEW_REQUIRED) {
    if (!(field in review)) errors.push(diagnostic(`${path}.${field}`, 'REQUIRED', `${field} is required.`));
  }
  if (!isNonEmptyString(review.case_id)) errors.push(diagnostic(`${path}.case_id`, 'STRING', 'case_id must be non-empty.'));
  if (typeof review.complete !== 'boolean') errors.push(diagnostic(`${path}.complete`, 'BOOLEAN', 'complete must be boolean.'));
  if (!DECISIONS.has(review.decision)) errors.push(diagnostic(`${path}.decision`, 'ENUM', 'decision is invalid.'));
  if (review.decision == null && review.complete) {
    errors.push(diagnostic(`${path}.decision`, 'INCOMPLETE_REVIEW', 'A complete review must set a decision.'));
  }
  validateScores(review.scores, `${path}.scores`, errors);
  validateHumanTime(review.human_time, `${path}.human_time`, errors);
  validateConvergence(review.convergence, `${path}.convergence`, errors);
  validateObservations(review.observations, `${path}.observations`, errors);
  validateMachineEvidence(review.machine_evidence ?? null, `${path}.machine_evidence`, errors);
  if (review.complete) {
    const missingScores = SCORE_KEYS.filter(k => review.scores?.[k] == null);
    if (missingScores.length) {
      errors.push(diagnostic(`${path}.scores`, 'INCOMPLETE_REVIEW', `A complete review requires all four scores; missing: ${missingScores.join(', ')}.`));
    }
  }
}

export function validateHumanReviewPackage(pkg) {
  const errors = [];
  if (!isObject(pkg)) {
    return {
      valid: false,
      errors: [diagnostic('$', 'OBJECT', 'Human review package must be an object.')],
      package: null,
    };
  }
  const allowedTop = new Set([...REQUIRED_TOP, 'machine_evidence_ref', 'blind_review']);
  assertNoExtra(pkg, allowedTop, '$', errors);
  for (const field of REQUIRED_TOP) {
    if (!(field in pkg)) errors.push(diagnostic(`$.${field}`, 'REQUIRED', `${field} is required.`));
  }
  if (pkg.schema_version !== 2) errors.push(diagnostic('$.schema_version', 'CONST', 'schema_version must be 2.'));
  for (const field of ['run_id', 'reviewer', 'isolation']) {
    if (!isNonEmptyString(pkg[field])) errors.push(diagnostic(`$.${field}`, 'STRING', `${field} must be non-empty.`));
  }
  if (!Array.isArray(pkg.reviews) || pkg.reviews.length === 0) {
    errors.push(diagnostic('$.reviews', 'MIN_ITEMS', 'At least one review is required.'));
  } else {
    pkg.reviews.forEach((review, index) => validateReview(review, index, errors));
  }
  if (typeof pkg.reviewed_at !== 'string' || Number.isNaN(Date.parse(pkg.reviewed_at))) {
    errors.push(diagnostic('$.reviewed_at', 'DATE_TIME', 'reviewed_at must be an ISO date-time string.'));
  }
  if ('blind_review' in pkg && typeof pkg.blind_review !== 'boolean') {
    errors.push(diagnostic('$.blind_review', 'BOOLEAN', 'blind_review must be boolean when present.'));
  }
  if ('machine_evidence_ref' in pkg && pkg.machine_evidence_ref !== null && !isNonEmptyString(pkg.machine_evidence_ref)) {
    errors.push(diagnostic('$.machine_evidence_ref', 'STRING', 'machine_evidence_ref must be a non-empty string or null.'));
  }
  if (errors.length) return { valid: false, errors, package: null };
  return { valid: true, errors: [], package: pkg };
}

/**
 * Normalize a raw draft payload (as produced by the prototype form) into a
 * complete human-review package. Missing optional fields get safe defaults
 * and `reviewed_at` is stamped if absent. Drafts are valid even when some
 * scores are unset (they become null).
 */
export function buildHumanReviewPackage(input) {
  const reviews = Array.isArray(input?.reviews)
    ? input.reviews.map(review => normalizeReview(review))
    : [];
  return {
    schema_version: 2,
    run_id: input?.run_id ?? '',
    reviewer: input?.reviewer ?? '',
    isolation: input?.isolation ?? 'file-isolated-development',
    machine_evidence_ref: input?.machine_evidence_ref ?? null,
    blind_review: input?.blind_review ?? false,
    reviews,
    reviewed_at: input?.reviewed_at ?? new Date().toISOString(),
  };
}

function normalizeReview(review) {
  const scores = SCORE_KEYS.reduce((acc, key) => {
    const v = Number(review?.scores?.[key]);
    acc[key] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
    return acc;
  }, {});
  const decision = review?.decision || null;
  const complete = review?.complete === true || (
    SCORE_KEYS.every(key => scores[key] != null) && DECISIONS.has(decision) && decision != null
  );
  return {
    case_id: review?.case_id ?? '',
    complete: Boolean(complete),
    decision,
    machine_evidence: review?.machine_evidence ?? null,
    scores,
    human_time: HUMAN_TIME_KEYS.reduce((acc, key) => {
      const v = Number(review?.human_time?.[key]);
      acc[key] = Number.isInteger(v) && v >= 0 ? v : 0;
      return acc;
    }, {}),
    convergence: CONVERGENCE_KEYS.reduce((acc, key) => {
      const v = Number(review?.convergence?.[key]);
      const max = key === 'first_poc_fitness_percent' ? 100 : Infinity;
      acc[key] = Number.isInteger(v) && v >= 0 && v <= max ? v : 0;
      return acc;
    }, {}),
    observations: OBSERVATION_KEYS.reduce((acc, key) => {
      acc[key] = typeof review?.observations?.[key] === 'string' ? review.observations[key] : '';
      return acc;
    }, {}),
  };
}

/**
 * Load and validate a human-review.json file. Used by the review prototype
 * (via fetch) and by the integration tests.
 */
export function loadHumanReviewPackage(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    return { valid: false, errors: [diagnostic('$', 'MISSING_FILE', `File not found: ${abs}`)], package: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    return { valid: false, errors: [diagnostic('$', 'PARSE_ERROR', error.message)], package: null };
  }
  return validateHumanReviewPackage(parsed);
}
