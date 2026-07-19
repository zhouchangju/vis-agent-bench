// Evidence serialisation.
//
// Every evaluator run produces one EvidenceBundle: the list of CheckResults
// plus the Scorecard, with stable field names so reports can diff across
// runs. Evidence is serialisable JSON; large captures (stdout/stderr/logs)
// are referenced by path, never inlined.

import { isStatus, STATUS } from './status.mjs';

export function createEvidenceBundle({
  runId,
  caseId,
  results,
  scorecard,
  rubricFingerprint = null,
  startedAt = null,
  completedAt = null,
  notes = null,
}) {
  if (!Array.isArray(results)) {
    throw new TypeError('createEvidenceBundle: results must be an array.');
  }
  if (!scorecard || typeof scorecard !== 'object') {
    throw new TypeError('createEvidenceBundle: scorecard is required.');
  }
  for (const result of results) {
    if (!result.check_id || typeof result.check_id !== 'string') {
      throw new TypeError('createEvidenceBundle: every result needs a check_id.');
    }
    if (!isStatus(result.status)) {
      throw new TypeError(`createEvidenceBundle: result "${result.check_id}" has invalid status.`);
    }
  }
  return Object.freeze({
    schema_version: 1,
    run_id: runId || null,
    case_id: caseId || null,
    rubric_fingerprint: rubricFingerprint || hashRubric(scorecard),
    started_at: startedAt || new Date().toISOString(),
    completed_at: completedAt || new Date().toISOString(),
    status: scorecard.status,
    summary: scorecard.summary,
    total: scorecard.total,
    raw_total: scorecard.raw_total,
    effective_cap: scorecard.effective_cap,
    applied_caps: scorecard.applied_caps,
    hard_gates: scorecard.hard_gates,
    p0: scorecard.p0,
    completeness: scorecard.completeness,
    categories: scorecard.categories,
    results: results.map(redactResult),
    notes: notes || null,
    next_actions: scorecard.next_actions,
  });
}

// Redact potentially large payloads before serialising. The runner already
// kept stdout/stderr on disk and stored paths in the result, so we only
// preserve compact diagnostic fields.
function redactResult(result) {
  return {
    check_id: result.check_id,
    status: result.status,
    reason: result.reason || null,
    level: result.level || null,
    category: result.category || null,
    hard_gate: result.hard_gate === true || result.hard_gate === 'true',
    failure_source: result.failure_source || null,
    duration_ms: typeof result.duration_ms === 'number' ? result.duration_ms : 0,
    command: result.command || null,
    exit_code: result.exit_code ?? null,
    signal: result.signal ?? null,
    timed_out: result.timed_out === true,
    stdout_path: result.stdout_path || null,
    stderr_path: result.stderr_path || null,
    artifacts: Array.isArray(result.artifacts) ? [...result.artifacts] : [],
    evidence: result.evidence || null,
  };
}

export function summariseBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return 'No evidence bundle provided.';
  const { total, status, completeness } = bundle;
  const counts = countByStatus(bundle.results || []);
  const lines = [
    `status=${status}`,
    `total=${total}`,
    `pass=${counts.pass}`,
    `fail=${counts.fail}`,
    `warning=${counts.warning}`,
    `skipped=${counts.skipped}`,
    `error=${counts.error}`,
  ];
  if (completeness?.duplicate_check_ids?.length) {
    lines.push(`duplicate_ids=${completeness.duplicate_check_ids.length}`);
  }
  return lines.join(' ');
}

function countByStatus(results) {
  const counts = { pass: 0, fail: 0, warning: 0, skipped: 0, error: 0 };
  for (const result of results) {
    if (counts[result.status] != null) counts[result.status] += 1;
  }
  return counts;
}

// Tiny fingerprint over the scorecard so we can detect drift in rubric
// weighting between runs. Not cryptographic.
function hashRubric(scorecard) {
  const payload = JSON.stringify({
    caps: scorecard.applied_caps || [],
    categories: Object.fromEntries(
      Object.entries(scorecard.categories || {}).map(([k, v]) => [k, { w: v.weight, c: v.counts }])
    ),
    hardGates: scorecard.hard_gates?.declared || [],
    p0Min: scorecard.p0?.min_score ?? null,
  });
  let h = 0;
  for (let i = 0; i < payload.length; i += 1) {
    h = (h * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return `v1:${h.toString(16).padStart(8, '0')}`;
}

// Convenience filter used by reporters: split results by failure source so
// project failures (system under test) and harness faults (evaluator bugs)
// never get muddled in summaries.
export function partitionByFailureSource(results) {
  const buckets = { project: [], evaluator: [], none: [] };
  for (const result of results) {
    if (result.status === STATUS.PASS || result.status === STATUS.WARNING) {
      buckets.none.push(result);
    } else if (result.failure_source === 'evaluator') {
      buckets.evaluator.push(result);
    } else {
      buckets.project.push(result);
    }
  }
  return buckets;
}
