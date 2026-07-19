// Report builders for VAB-T07.
//
// The builders take an array of "report entries" (Run result + optional
// evaluator + optional human review + optional isolation descriptor + optional
// human baseline) and return a JSON object that conforms to
// schemas/report.schema.json. They never run a model, browser or evaluator;
// they only aggregate already collected evidence.
//
// Three views are supported:
//   - single-run      : one Run entry, no cross-run aggregation.
//   - case-models     : same Case, multiple model entries (compare models).
//   - model-cases     : same model, multiple Case entries (compare tasks).

import {
  acceptedDeliveryRate,
  aggregateHumanTouchTime,
  buildCapabilityBoundaries,
  buildCaseConclusion,
  buildFailureModes,
  buildFactLayers,
  caseIdOf,
  computeEffectiveSpeedup,
  computeEvidenceCompleteness,
  deriveHeadline,
  deriveVerdict,
  modelLabel,
  runIdOf,
  summarizeCost,
} from './aggregate.mjs';

export function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Report entry must be an object.');
  }
  const run = entry.run || {};
  const humanReviewRaw = entry.human_review || null;
  const normalized = {
    run: { ...run },
    evaluator: entry.evaluator || null,
    isolation: entry.isolation || null,
    browser: entry.browser || null,
    baseline: entry.baseline || null,
    case_meta: entry.case_meta || null,
    demo: Boolean(entry.demo),
  };

  if (humanReviewRaw) {
    const reviews = Array.isArray(humanReviewRaw.reviews) ? humanReviewRaw.reviews : [];
    const reduced = reviews.length > 1
      ? reduceMultipleReviews(humanReviewRaw, reviews)
      : (reviews[0] ? mergeReviewWithPackage(humanReviewRaw, reviews[0]) : humanReviewRaw);
    normalized.human_review = reduced;
  } else {
    normalized.human_review = null;
  }

  if (normalized.human_review && !('decision' in normalized.human_review)) {
    normalized.human_review.decision = null;
  }
  return normalized;
}

function mergeReviewWithPackage(pkg, review) {
  const humanTime = review.human_time || {};
  const totalMinutes = Object.values(humanTime).reduce(
    (sum, value) => sum + (typeof value === 'number' ? value : 0),
    0,
  );
  return {
    ...pkg,
    ...review,
    human_time: humanTime,
    human_time_total_minutes: totalMinutes,
  };
}

function reduceMultipleReviews(pkg, reviews) {
  // For multi-stage runs the human-review package may carry one review per
  // stage. We reduce them to a single per-run summary while keeping the
  // bucketed minutes so reports can still show the breakdown.
  const totals = {
    clarification_minutes: 0,
    context_prep_minutes: 0,
    poc_review_minutes: 0,
    micro_adjustment_minutes: 0,
    fix_minutes: 0,
    final_review_minutes: 0,
  };
  for (const review of reviews) {
    for (const [key, value] of Object.entries(review.human_time || {})) {
      if (typeof value === 'number') totals[key] += value;
    }
  }
  const decisions = reviews.map(r => r.decision).filter(Boolean);
  const decisionSet = new Set(decisions);
  const decision = decisionSet.size === 1 ? [...decisionSet][0]
    : (decisionSet.size > 1 ? 'partial' : null);
  const scoresAggregate = averageScores(reviews);
  const observations = mergeObservations(reviews);
  const convergence = aggregateConvergence(reviews);
  return {
    schema_version: pkg.schema_version,
    run_id: pkg.run_id,
    reviewer: pkg.reviewer,
    reviewed_at: pkg.reviewed_at,
    decision,
    scores: scoresAggregate,
    human_time: totals,
    human_time_total_minutes: Object.values(totals).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0),
    convergence,
    observations,
    complete: reviews.every(r => r.complete !== false),
  };
}

function averageScores(reviews) {
  const keys = ['business', 'visual', 'interaction', 'usability'];
  const result = {};
  for (const key of keys) {
    const values = reviews
      .map(r => r.scores?.[key])
      .filter(v => typeof v === 'number');
    result[key] = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  }
  return result;
}

function mergeObservations(reviews) {
  const fields = ['strengths', 'problems', 'required_fixes', 'management_judgment'];
  const merged = {};
  for (const field of fields) {
    const texts = reviews.map(r => r.observations?.[field]).filter(Boolean);
    merged[field] = texts.length ? texts.join(' / ') : (field === 'management_judgment' ? '' : '');
  }
  return merged;
}

function aggregateConvergence(reviews) {
  const keys = [
    'clarification_rounds',
    'iterations_to_acceptance',
    'micro_adjustment_items',
    'must_have_misses',
    'requirement_regressions',
  ];
  const result = {};
  for (const key of keys) {
    const values = reviews.map(r => r.convergence?.[key]).filter(v => typeof v === 'number');
    result[key] = values.length ? values.reduce((a, b) => a + b, 0) : 0;
  }
  const fitnessValues = reviews.map(r => r.convergence?.first_poc_fitness_percent).filter(v => typeof v === 'number');
  result.first_poc_fitness_percent = fitnessValues.length
    ? Math.round(fitnessValues.reduce((a, b) => a + b, 0) / fitnessValues.length)
    : 0;
  return result;
}

function buildEvidenceIndex(entries) {
  const index = [];
  for (const entry of entries) {
    const runId = runIdOf(entry);
    const label = `${modelLabel(entry)} · ${caseIdOf(entry)}`;
    index.push({ handle: `run:${runId}`, kind: 'run', label, path: entry.run?.path || '' });
    if (entry.evaluator) {
      index.push({ handle: `evaluator:${runId}`, kind: 'evaluator', label: `Evaluator ${runId}`, path: entry.evaluator?.path || '' });
    }
    if (entry.human_review) {
      index.push({ handle: `human-review:${runId}`, kind: 'human-review', label: `Human review ${runId}`, path: entry.human_review?.path || '' });
    }
    if (entry.isolation) {
      index.push({ handle: `isolation:${runId}`, kind: 'isolation', label: `Isolation ${runId}`, path: entry.isolation?.path || '' });
    }
    if (entry.browser) {
      index.push({ handle: `browser:${runId}`, kind: 'browser', label: `Browser evidence ${runId}`, path: entry.browser?.path || '' });
    }
  }
  return index;
}

function buildDataProvenance(entries) {
  const inputs = entries.map(entry => ({
    run_id: runIdOf(entry),
    case_id: caseIdOf(entry),
    model_label: modelLabel(entry),
    demo: Boolean(entry.demo),
    has_human_review: Boolean(entry.human_review),
    has_evaluator: Boolean(entry.evaluator),
    accepted: Boolean(entry.human_review
      && ['accepted', 'accepted-with-fixes'].includes(entry.human_review.decision)),
  }));
  return {
    inputs,
    demo_inputs_present: inputs.some(input => input.demo),
    leaderboard_eligible: entries.every(entry => entry.isolation?.leaderboard_eligible === true),
  };
}

function recommendedActions(verdict, evidenceCompleteness, humanTouch) {
  const actions = [];
  if (evidenceCompleteness.missing.includes('human-review')) {
    actions.push({
      title: 'Complete human review before publishing leadership conclusions',
      priority: 'now',
      rationale: 'Without human review the report cannot compute Accepted Delivery Rate or Effective Speedup.',
    });
  }
  if (evidenceCompleteness.missing.includes('evaluator')) {
    actions.push({
      title: 'Run the deterministic evaluator on each Run',
      priority: 'now',
      rationale: 'P0 state is currently derived from incomplete evidence.',
    });
  }
  if (verdict === 'replaceable-delivery') {
    actions.push({
      title: 'Pilot the candidate in a narrow scope with conventional review',
      priority: 'next',
      rationale: 'Verdict reached replaceable-delivery; scale only after pilot review.',
    });
  } else if (verdict === 'high-value-assist') {
    actions.push({
      title: 'Position candidate as a high-value assistant, not a replacement',
      priority: 'next',
      rationale: 'Savings concentrate in first-version work; convergence and visual review still need humans.',
    });
  } else if (verdict === 'limited-assist') {
    actions.push({
      title: 'Keep candidate in an exploratory role and continue tuning',
      priority: 'next',
      rationale: 'Rework cost dominates; do not move into delivery path yet.',
    });
  } else {
    actions.push({
      title: 'Do not change the main workflow based on this report',
      priority: 'next',
      rationale: 'Evidence is insufficient or quality is unstable.',
    });
  }
  if (humanTouch.source === 'partial') {
    actions.push({
      title: 'Backfill missing human-review packages',
      priority: 'watch',
      rationale: 'Human touch numbers are partial and may hide rework.',
    });
  }
  return actions;
}

function buildLeadershipSummary(entries, caseConclusions, baseline) {
  const acceptedRate = acceptedDeliveryRate(entries);
  const humanTouch = aggregateHumanTouchTime(entries);
  const candidateMinutes = humanTouch.total_minutes;
  const speedup = computeEffectiveSpeedup(entries, baseline || null);
  // computeEffectiveSpeedup recomputes candidate minutes from accepted runs only;
  // if we have baseline but candidate wasn't accepted, the speedup stays ineligible.
  const speedupWithCandidate = speedup.eligible
    ? speedup
    : { ...speedup, candidate_minutes: candidateMinutes };
  const verdict = deriveVerdict(caseConclusions, speedupWithCandidate);
  const headline = deriveHeadline(verdict, speedupWithCandidate, acceptedRate);
  return {
    headline,
    verdict,
    effective_speedup: speedupWithCandidate,
    accepted_delivery_rate: acceptedRate,
  };
}

function detectViewKind(scopeHint, entries) {
  if (scopeHint === 'single-run' || entries.length === 1) return 'single-run';
  const caseIds = new Set(entries.map(caseIdOf));
  const modelIds = new Set(entries.map(modelLabel));
  if (caseIds.size === 1 && modelIds.size > 1) return 'case-models';
  if (modelIds.size === 1 && caseIds.size > 1) return 'model-cases';
  // Mixed input — fall back to the largest single grouping so the report stays
  // honest about what it is comparing.
  return 'model-cases';
}

function buildCaseConclusionsForView(entries, viewKind) {
  const groups = new Map();
  for (const entry of entries) {
    const key = viewKind === 'model-cases'
      ? caseIdOf(entry)
      : (viewKind === 'case-models' ? modelLabel(entry) : runIdOf(entry));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const conclusions = [];
  for (const [key, groupedEntries] of groups.entries()) {
    const first = groupedEntries[0];
    const caseMeta = first?.case_meta || { title: key };
    const caseId = viewKind === 'model-cases'
      ? caseIdOf(first)
      : (viewKind === 'case-models' ? key : caseIdOf(first));
    conclusions.push(buildCaseConclusion(caseId, groupedEntries, caseMeta));
  }
  return conclusions;
}

export function buildReport({ entries: rawEntries, reportId, generatedAt, scopeHint, baseline, title }) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new Error('At least one report entry is required.');
  }
  const entries = rawEntries.map(normalizeEntry);
  const viewKind = detectViewKind(scopeHint, entries);
  const evidenceCompleteness = computeEvidenceCompleteness(entries);
  const caseConclusions = buildCaseConclusionsForView(entries, viewKind);
  const leadership = buildLeadershipSummary(entries, caseConclusions, baseline);
  const humanTouch = aggregateHumanTouchTime(entries);
  const costSummary = summarizeCost(entries);
  const capabilityBoundaries = buildCapabilityBoundaries(caseConclusions);
  const failureModes = buildFailureModes(entries, caseConclusions);
  const factLayers = buildFactLayers(entries, {
    accepted_delivery_rate: leadership.accepted_delivery_rate,
    effective_speedup: leadership.effective_speedup,
  });
  const evidenceIndex = buildEvidenceIndex(entries);
  const dataProvenance = buildDataProvenance(entries);
  const recommended = recommendedActions(leadership.verdict, evidenceCompleteness, humanTouch);
  const demoInputsPresent = dataProvenance.demo_inputs_present;

  const report = {
    schema_version: 1,
    report_id: reportId,
    generated_at: generatedAt,
    title: title || defaultTitle(viewKind, entries),
    view: {
      kind: viewKind,
      scope: {
        run_ids: entries.map(runIdOf),
        case_ids: [...new Set(entries.map(caseIdOf))],
        model_labels: [...new Set(entries.map(modelLabel))],
      },
      demo: demoInputsPresent,
    },
    evidence_completeness: evidenceCompleteness,
    fact_layers: factLayers,
    leadership_summary: leadership,
    capability_boundaries: capabilityBoundaries,
    case_conclusions: caseConclusions,
    human_touch_breakdown: humanTouch,
    cost_summary: costSummary,
    failure_modes: failureModes,
    recommended_actions: recommended,
    evidence_index: evidenceIndex,
    data_provenance: dataProvenance,
    result_envelope: {
      status: demoInputsPresent ? 'warning' : 'success',
      summary: `Report ${reportId} generated for ${viewKind} view (${entries.length} run(s)).`,
      next_actions: recommended.slice(0, 3).map(action => action.title),
      artifacts: [],
    },
  };
  return report;
}

function defaultTitle(viewKind, entries) {
  const caseIds = [...new Set(entries.map(caseIdOf))];
  const modelLabels = [...new Set(entries.map(modelLabel))];
  if (viewKind === 'single-run') {
    const entry = entries[0];
    return `Single-run report · ${modelLabel(entry)} · ${caseIdOf(entry)}`;
  }
  if (viewKind === 'case-models') {
    return `Model comparison · case ${caseIds.join(', ')}`;
  }
  return `Case coverage · model ${modelLabels.join(', ')}`;
}
