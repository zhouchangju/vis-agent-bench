// Narrow validator for the VAB-T07 report schema.
//
// Mirrors schemas/report.schema.json so the harness can fail fast without a
// heavyweight JSON Schema runtime. Returns the same diagnostic shape used by
// src/contracts/index.mjs so the rest of the harness keeps a single error
// vocabulary.

function diagnostic(path, code, message) {
  return { path, code, message };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireFields(value, fields, path, errors) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) errors.push(diagnostic(`${path}.${field}`, 'REQUIRED', 'Field is required.'));
  }
}

function ensureNoExtraFields(value, allowed, path, errors) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(diagnostic(`${path}.${field}`, 'UNEXPECTED_FIELD', 'Field is not allowed by this contract.'));
  }
}

const EVIDENCE_KINDS = new Set(['run', 'evaluator', 'human-review', 'baseline', 'isolation', 'browser', 'stage-log']);
const FACT_SOURCES = new Set(['machine', 'human', 'inferred', 'unverified']);
const VERDICTS = new Set(['replaceable-delivery', 'high-value-assist', 'limited-assist', 'not-applicable', null]);
const VIEW_KINDS = new Set(['single-run', 'case-models', 'model-cases']);
const PRIORITIES = new Set(['now', 'next', 'watch']);

const REQUIRED_TOP = new Set([
  'schema_version', 'report_id', 'generated_at', 'view',
  'evidence_completeness', 'fact_layers', 'leadership_summary',
  'capability_boundaries', 'case_conclusions', 'human_touch_breakdown',
  'failure_modes', 'recommended_actions', 'evidence_index', 'data_provenance',
]);

const OPTIONAL_TOP = new Set([...REQUIRED_TOP, 'title', 'cost_summary', 'result_envelope']);

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.some(item => !isNonEmptyString(item))) {
    errors.push(diagnostic(path, 'STRING_ARRAY', 'Expected an array of non-empty strings.'));
  }
}

function validateFactList(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(diagnostic(path, 'ARRAY', 'Expected an array.'));
    return;
  }
  value.forEach((fact, index) => {
    const factPath = `${path}[${index}]`;
    if (!isObject(fact)) {
      errors.push(diagnostic(factPath, 'OBJECT', 'Fact must be an object.'));
      return;
    }
    requireFields(fact, ['id', 'source', 'statement'], factPath, errors);
    ensureNoExtraFields(fact, new Set(['id', 'source', 'statement', 'evidence_refs']), factPath, errors);
    if (!isNonEmptyString(fact.id)) errors.push(diagnostic(`${factPath}.id`, 'STRING', 'id must be non-empty.'));
    if (!FACT_SOURCES.has(fact.source)) errors.push(diagnostic(`${factPath}.source`, 'ENUM', 'source must be machine, human, inferred or unverified.'));
    if (!isNonEmptyString(fact.statement)) errors.push(diagnostic(`${factPath}.statement`, 'STRING', 'statement must be non-empty.'));
    if (fact.evidence_refs != null) validateStringArray(fact.evidence_refs, `${factPath}.evidence_refs`, errors);
  });
}

function validateMinutes(value, path, errors) {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(diagnostic(path, 'MINUTES', 'Minutes must be a non-negative number or null.'));
  }
}

function validateRate(value, path, errors) {
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'Rate must be an object.'));
    return;
  }
  requireFields(value, ['percent', 'accepted', 'reviewed', 'source'], path, errors);
  ensureNoExtraFields(value, new Set(['percent', 'accepted', 'reviewed', 'source']), path, errors);
  if (value.percent !== null) {
    if (typeof value.percent !== 'number' || !Number.isInteger(value.percent) || value.percent < 0 || value.percent > 100) {
      errors.push(diagnostic(`${path}.percent`, 'RANGE', 'percent must be 0..100 or null.'));
    }
  }
  if (typeof value.accepted !== 'number' || value.accepted < 0) errors.push(diagnostic(`${path}.accepted`, 'RANGE', 'accepted must be >= 0.'));
  if (typeof value.reviewed !== 'number' || value.reviewed < 0) errors.push(diagnostic(`${path}.reviewed`, 'RANGE', 'reviewed must be >= 0.'));
  if (!['human-review', 'unavailable'].includes(value.source)) errors.push(diagnostic(`${path}.source`, 'ENUM', 'source must be human-review or unavailable.'));
}

function validateSpeedup(value, path, errors) {
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'Speedup must be an object.'));
    return;
  }
  requireFields(value, ['ratio', 'baseline_minutes', 'candidate_minutes', 'source', 'eligible'], path, errors);
  ensureNoExtraFields(value, new Set(['ratio', 'baseline_minutes', 'candidate_minutes', 'source', 'eligible']), path, errors);
  if (value.ratio !== null && (typeof value.ratio !== 'number' || value.ratio < 0)) errors.push(diagnostic(`${path}.ratio`, 'RANGE', 'ratio must be >= 0 or null.'));
  validateMinutes(value.baseline_minutes, `${path}.baseline_minutes`, errors);
  validateMinutes(value.candidate_minutes, `${path}.candidate_minutes`, errors);
  if (!['human-review', 'baseline-missing', 'unavailable'].includes(value.source)) errors.push(diagnostic(`${path}.source`, 'ENUM', 'source is invalid.'));
  if (typeof value.eligible !== 'boolean') errors.push(diagnostic(`${path}.eligible`, 'BOOLEAN', 'eligible must be boolean.'));
}

function validateCaseConclusion(value, index, errors) {
  const path = `case_conclusions[${index}]`;
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'Case conclusion must be an object.'));
    return;
  }
  requireFields(value, ['case_id', 'decision', 'p0_state', 'evidence_refs'], path, errors);
  ensureNoExtraFields(value, new Set(['case_id', 'title', 'decision', 'p0_state', 'judgment', 'scores', 'detail', 'evidence_refs']), path, errors);
  if (!isNonEmptyString(value.case_id)) errors.push(diagnostic(`${path}.case_id`, 'STRING', 'case_id must be non-empty.'));
  if (!['accepted', 'accepted-with-fixes', 'partial', 'rejected', 'invalid-run', 'mixed', null].includes(value.decision)) {
    errors.push(diagnostic(`${path}.decision`, 'ENUM', 'decision is invalid.'));
  }
  if (!['passed', 'partial', 'failed', 'unknown'].includes(value.p0_state)) errors.push(diagnostic(`${path}.p0_state`, 'ENUM', 'p0_state is invalid.'));
  if (value.judgment != null && !['replaceable-delivery', 'high-value-assist', 'limited-assist', 'not-applicable', 'unknown'].includes(value.judgment)) {
    errors.push(diagnostic(`${path}.judgment`, 'ENUM', 'judgment is invalid.'));
  }
  validateStringArray(value.evidence_refs, `${path}.evidence_refs`, errors);
  if (value.scores != null) {
    ensureNoExtraFields(value.scores, new Set(['business', 'visual', 'interaction', 'usability']), `${path}.scores`, errors);
    for (const key of ['business', 'visual', 'interaction', 'usability']) {
      const score = value.scores[key];
      if (score !== null && (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5)) {
        errors.push(diagnostic(`${path}.scores.${key}`, 'RANGE', 'Score must be 1..5 or null.'));
      }
    }
  }
}

export function validateReport(report) {
  const errors = [];
  if (!isObject(report)) {
    return {
      valid: false,
      errors: [diagnostic('$', 'OBJECT', 'Report must be an object.')],
      result: {
        status: 'error',
        summary: 'Report is not an object.',
        next_actions: ['Provide a report object built by src/reporting/builders.mjs.'],
        artifacts: [],
        error: { root_cause_hint: 'Report input is not an object.', safe_retry: 'Rebuild the report with buildReport().', stop_condition: 'Do not render until report is valid.' },
      },
    };
  }
  requireFields(report, [...REQUIRED_TOP], '$', errors);
  ensureNoExtraFields(report, OPTIONAL_TOP, '$', errors);
  if (report.schema_version !== undefined && report.schema_version !== 1) errors.push(diagnostic('$.schema_version', 'CONST', 'schema_version must be 1.'));
  if (!isNonEmptyString(report.report_id)) errors.push(diagnostic('$.report_id', 'STRING', 'report_id must be non-empty.'));
  if (report.title !== undefined && !isNonEmptyString(report.title)) errors.push(diagnostic('$.title', 'STRING', 'title must be non-empty when present.'));
  if (!isNonEmptyString(report.generated_at)) errors.push(diagnostic('$.generated_at', 'STRING', 'generated_at must be non-empty ISO datetime.'));
  validateView(report.view, errors);
  validateEvidenceCompleteness(report.evidence_completeness, errors);
  validateFactLayers(report.fact_layers, errors);
  validateLeadership(report.leadership_summary, errors);
  validateCapabilityBoundaries(report.capability_boundaries, errors);
  if (!Array.isArray(report.case_conclusions)) errors.push(diagnostic('$.case_conclusions', 'ARRAY', 'case_conclusions must be an array.'));
  else report.case_conclusions.forEach((c, i) => validateCaseConclusion(c, i, errors));
  validateHumanTouch(report.human_touch_breakdown, errors);
  validateCostSummary(report.cost_summary, errors);
  validateFailureModes(report.failure_modes, errors);
  validateRecommendedActions(report.recommended_actions, errors);
  validateEvidenceIndex(report.evidence_index, errors);
  validateDataProvenance(report.data_provenance, errors);
  if (errors.length) {
    return {
      valid: false,
      errors,
      result: {
        status: 'error',
        summary: `Report failed validation with ${errors.length} issue(s).`,
        next_actions: errors.slice(0, 5).map(error => `Fix ${error.path}: ${error.message}`),
        artifacts: [],
        error: { root_cause_hint: errors[0]?.message || 'Invalid report.', safe_retry: 'Rebuild the report with the corrected inputs.', stop_condition: 'Do not publish until report validates.' },
      },
    };
  }
  return { valid: true, errors: [], result: report };
}

function validateView(view, errors) {
  if (!isObject(view)) {
    errors.push(diagnostic('$.view', 'OBJECT', 'view must be an object.'));
    return;
  }
  requireFields(view, ['kind', 'scope'], '$.view', errors);
  ensureNoExtraFields(view, new Set(['kind', 'scope', 'demo']), '$.view', errors);
  if (!VIEW_KINDS.has(view.kind)) errors.push(diagnostic('$.view.kind', 'ENUM', 'kind must be single-run, case-models or model-cases.'));
  if (view.demo !== undefined && typeof view.demo !== 'boolean') errors.push(diagnostic('$.view.demo', 'BOOLEAN', 'demo must be boolean.'));
  if (!isObject(view.scope)) {
    errors.push(diagnostic('$.view.scope', 'OBJECT', 'scope must be an object.'));
    return;
  }
  ensureNoExtraFields(view.scope, new Set(['run_ids', 'case_ids', 'model_labels']), '$.view.scope', errors);
  for (const key of ['run_ids', 'case_ids', 'model_labels']) {
    if (view.scope[key] != null) validateStringArray(view.scope[key], `$.view.scope.${key}`, errors);
  }
}

function validateEvidenceCompleteness(value, errors) {
  const path = '$.evidence_completeness';
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'evidence_completeness must be an object.'));
    return;
  }
  requireFields(value, ['percent', 'missing', 'present'], path, errors);
  ensureNoExtraFields(value, new Set(['percent', 'missing', 'present']), path, errors);
  if (typeof value.percent !== 'number' || !Number.isInteger(value.percent) || value.percent < 0 || value.percent > 100) {
    errors.push(diagnostic(`${path}.percent`, 'RANGE', 'percent must be 0..100 integer.'));
  }
  for (const key of ['present', 'missing']) {
    if (!Array.isArray(value[key])) {
      errors.push(diagnostic(`${path}.${key}`, 'ARRAY', `${key} must be an array.`));
      continue;
    }
    value[key].forEach((kind, index) => {
      if (!EVIDENCE_KINDS.has(kind)) errors.push(diagnostic(`${path}.${key}[${index}]`, 'ENUM', `Evidence kind ${kind} is not recognised.`));
    });
  }
}

function validateFactLayers(value, errors) {
  const path = '$.fact_layers';
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'fact_layers must be an object.'));
    return;
  }
  requireFields(value, ['machine', 'human', 'inferred', 'unverified'], path, errors);
  ensureNoExtraFields(value, new Set(['machine', 'human', 'inferred', 'unverified']), path, errors);
  for (const key of ['machine', 'human', 'inferred', 'unverified']) {
    validateFactList(value[key], `${path}.${key}`, errors);
  }
}

function validateLeadership(value, errors) {
  const path = '$.leadership_summary';
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'leadership_summary must be an object.'));
    return;
  }
  requireFields(value, ['headline', 'verdict', 'effective_speedup', 'accepted_delivery_rate'], path, errors);
  ensureNoExtraFields(value, new Set(['headline', 'verdict', 'effective_speedup', 'accepted_delivery_rate']), path, errors);
  if (!isNonEmptyString(value.headline)) errors.push(diagnostic(`${path}.headline`, 'STRING', 'headline must be non-empty.'));
  if (!VERDICTS.has(value.verdict)) errors.push(diagnostic(`${path}.verdict`, 'ENUM', 'verdict is invalid.'));
  validateSpeedup(value.effective_speedup, `${path}.effective_speedup`, errors);
  validateRate(value.accepted_delivery_rate, `${path}.accepted_delivery_rate`, errors);
}

function validateCapabilityBoundaries(value, errors) {
  const path = '$.capability_boundaries';
  if (!Array.isArray(value)) {
    errors.push(diagnostic(path, 'ARRAY', 'capability_boundaries must be an array.'));
    return;
  }
  value.forEach((boundary, index) => {
    const bPath = `${path}[${index}]`;
    if (!isObject(boundary)) {
      errors.push(diagnostic(bPath, 'OBJECT', 'Boundary must be an object.'));
      return;
    }
    requireFields(boundary, ['scope', 'judgment', 'evidence_refs'], bPath, errors);
    ensureNoExtraFields(boundary, new Set(['scope', 'judgment', 'detail', 'evidence_refs']), bPath, errors);
    if (!isNonEmptyString(boundary.scope)) errors.push(diagnostic(`${bPath}.scope`, 'STRING', 'scope must be non-empty.'));
    if (!['replaceable-delivery', 'high-value-assist', 'limited-assist', 'not-applicable', 'unknown'].includes(boundary.judgment)) {
      errors.push(diagnostic(`${bPath}.judgment`, 'ENUM', 'judgment is invalid.'));
    }
    validateStringArray(boundary.evidence_refs, `${bPath}.evidence_refs`, errors);
  });
}

function validateHumanTouch(value, errors) {
  const path = '$.human_touch_breakdown';
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'human_touch_breakdown must be an object.'));
    return;
  }
  const required = [
    'clarification_minutes', 'context_prep_minutes', 'poc_review_minutes',
    'micro_adjustment_minutes', 'fix_minutes', 'final_review_minutes',
    'total_minutes', 'source',
  ];
  requireFields(value, required, path, errors);
  ensureNoExtraFields(value, new Set(required), path, errors);
  for (const key of required.filter(k => k !== 'source')) validateMinutes(value[key], `${path}.${key}`, errors);
  if (!['human-review', 'partial', 'unavailable'].includes(value.source)) errors.push(diagnostic(`${path}.source`, 'ENUM', 'source is invalid.'));
}

function validateCostSummary(value, errors) {
  if (value === undefined) return;
  const path = '$.cost_summary';
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'cost_summary must be an object.'));
    return;
  }
  requireFields(value, ['availability', 'reported_cost_usd', 'reported_tokens', 'currency_note'], path, errors);
  ensureNoExtraFields(value, new Set(['availability', 'reported_cost_usd', 'reported_tokens', 'currency_note']), path, errors);
  if (!['reported', 'partial', 'unavailable'].includes(value.availability)) errors.push(diagnostic(`${path}.availability`, 'ENUM', 'availability is invalid.'));
  if (value.reported_cost_usd !== null && (typeof value.reported_cost_usd !== 'number' || value.reported_cost_usd < 0)) {
    errors.push(diagnostic(`${path}.reported_cost_usd`, 'RANGE', 'reported_cost_usd must be >= 0 or null.'));
  }
  if (value.reported_tokens !== null) {
    if (!isObject(value.reported_tokens)) errors.push(diagnostic(`${path}.reported_tokens`, 'OBJECT', 'reported_tokens must be an object or null.'));
    else {
      ensureNoExtraFields(value.reported_tokens, new Set(['input_tokens', 'output_tokens', 'cached_tokens']), `${path}.reported_tokens`, errors);
      for (const key of ['input_tokens', 'output_tokens', 'cached_tokens']) {
        if (value.reported_tokens[key] !== undefined && (typeof value.reported_tokens[key] !== 'number' || value.reported_tokens[key] < 0)) {
          errors.push(diagnostic(`${path}.reported_tokens.${key}`, 'RANGE', `${key} must be >= 0.`));
        }
      }
    }
  }
  if (!isNonEmptyString(value.currency_note)) errors.push(diagnostic(`${path}.currency_note`, 'STRING', 'currency_note must be non-empty.'));
}

function validateFailureModes(value, errors) {
  const path = '$.failure_modes';
  if (!Array.isArray(value)) {
    errors.push(diagnostic(path, 'ARRAY', 'failure_modes must be an array.'));
    return;
  }
  value.forEach((failure, index) => {
    const fPath = `${path}[${index}]`;
    if (!isObject(failure)) {
      errors.push(diagnostic(fPath, 'OBJECT', 'Failure must be an object.'));
      return;
    }
    requireFields(failure, ['title', 'source', 'evidence_refs'], fPath, errors);
    ensureNoExtraFields(failure, new Set(['title', 'detail', 'source', 'evidence_refs']), fPath, errors);
    if (!isNonEmptyString(failure.title)) errors.push(diagnostic(`${fPath}.title`, 'STRING', 'title must be non-empty.'));
    if (!FACT_SOURCES.has(failure.source)) errors.push(diagnostic(`${fPath}.source`, 'ENUM', 'source is invalid.'));
    validateStringArray(failure.evidence_refs, `${fPath}.evidence_refs`, errors);
  });
}

function validateRecommendedActions(value, errors) {
  const path = '$.recommended_actions';
  if (!Array.isArray(value)) {
    errors.push(diagnostic(path, 'ARRAY', 'recommended_actions must be an array.'));
    return;
  }
  value.forEach((action, index) => {
    const aPath = `${path}[${index}]`;
    if (!isObject(action)) {
      errors.push(diagnostic(aPath, 'OBJECT', 'Action must be an object.'));
      return;
    }
    requireFields(action, ['title', 'priority', 'rationale'], aPath, errors);
    ensureNoExtraFields(action, new Set(['title', 'priority', 'rationale', 'evidence_refs']), aPath, errors);
    if (!isNonEmptyString(action.title)) errors.push(diagnostic(`${aPath}.title`, 'STRING', 'title must be non-empty.'));
    if (!PRIORITIES.has(action.priority)) errors.push(diagnostic(`${aPath}.priority`, 'ENUM', 'priority must be now, next or watch.'));
    if (!isNonEmptyString(action.rationale)) errors.push(diagnostic(`${aPath}.rationale`, 'STRING', 'rationale must be non-empty.'));
    if (action.evidence_refs != null) validateStringArray(action.evidence_refs, `${aPath}.evidence_refs`, errors);
  });
}

function validateEvidenceIndex(value, errors) {
  const path = '$.evidence_index';
  if (!Array.isArray(value)) {
    errors.push(diagnostic(path, 'ARRAY', 'evidence_index must be an array.'));
    return;
  }
  value.forEach((entry, index) => {
    const ePath = `${path}[${index}]`;
    if (!isObject(entry)) {
      errors.push(diagnostic(ePath, 'OBJECT', 'Index entry must be an object.'));
      return;
    }
    requireFields(entry, ['handle', 'kind', 'label'], ePath, errors);
    ensureNoExtraFields(entry, new Set(['handle', 'kind', 'label', 'path']), ePath, errors);
    if (!isNonEmptyString(entry.handle)) errors.push(diagnostic(`${ePath}.handle`, 'STRING', 'handle must be non-empty.'));
    if (!EVIDENCE_KINDS.has(entry.kind)) errors.push(diagnostic(`${ePath}.kind`, 'ENUM', 'kind is invalid.'));
    if (!isNonEmptyString(entry.label)) errors.push(diagnostic(`${ePath}.label`, 'STRING', 'label must be non-empty.'));
  });
}

function validateDataProvenance(value, errors) {
  const path = '$.data_provenance';
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'data_provenance must be an object.'));
    return;
  }
  requireFields(value, ['inputs', 'demo_inputs_present', 'leaderboard_eligible'], path, errors);
  ensureNoExtraFields(value, new Set(['inputs', 'demo_inputs_present', 'leaderboard_eligible']), path, errors);
  if (typeof value.demo_inputs_present !== 'boolean') errors.push(diagnostic(`${path}.demo_inputs_present`, 'BOOLEAN', 'demo_inputs_present must be boolean.'));
  if (typeof value.leaderboard_eligible !== 'boolean') errors.push(diagnostic(`${path}.leaderboard_eligible`, 'BOOLEAN', 'leaderboard_eligible must be boolean.'));
  if (!Array.isArray(value.inputs)) {
    errors.push(diagnostic(`${path}.inputs`, 'ARRAY', 'inputs must be an array.'));
    return;
  }
  value.inputs.forEach((input, index) => {
    const iPath = `${path}.inputs[${index}]`;
    if (!isObject(input)) {
      errors.push(diagnostic(iPath, 'OBJECT', 'Input must be an object.'));
      return;
    }
    requireFields(input, ['run_id', 'case_id', 'model_label', 'demo'], iPath, errors);
    ensureNoExtraFields(input, new Set([
      'run_id', 'case_id', 'model_label', 'demo', 'has_human_review', 'has_evaluator', 'accepted',
      'parent_run_id', 'revision_index',
    ]), iPath, errors);
    for (const key of ['run_id', 'case_id', 'model_label']) {
      if (!isNonEmptyString(input[key])) errors.push(diagnostic(`${iPath}.${key}`, 'STRING', `${key} must be non-empty.`));
    }
    if (typeof input.demo !== 'boolean') errors.push(diagnostic(`${iPath}.demo`, 'BOOLEAN', 'demo must be boolean.'));
    if (input.has_human_review !== undefined && typeof input.has_human_review !== 'boolean') errors.push(diagnostic(`${iPath}.has_human_review`, 'BOOLEAN', 'has_human_review must be boolean.'));
    if (input.has_evaluator !== undefined && typeof input.has_evaluator !== 'boolean') errors.push(diagnostic(`${iPath}.has_evaluator`, 'BOOLEAN', 'has_evaluator must be boolean.'));
    if (input.accepted !== undefined && typeof input.accepted !== 'boolean') errors.push(diagnostic(`${iPath}.accepted`, 'BOOLEAN', 'accepted must be boolean.'));
    if (input.parent_run_id !== undefined && !isNonEmptyString(input.parent_run_id)) errors.push(diagnostic(`${iPath}.parent_run_id`, 'STRING', 'parent_run_id must be non-empty when present.'));
    if (input.revision_index !== undefined && (!Number.isInteger(input.revision_index) || input.revision_index < 1)) errors.push(diagnostic(`${iPath}.revision_index`, 'RANGE', 'revision_index must be an integer >= 1 when present.'));
  });
}
