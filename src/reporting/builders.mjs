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
    revision: entry.revision || null,
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
      index.push({ handle: `evaluator:${runId}`, kind: 'evaluator', label: `自动评估 ${runId}`, path: entry.evaluator?.path || '' });
    }
    if (entry.human_review) {
      index.push({ handle: `human-review:${runId}`, kind: 'human-review', label: `人工评审 ${runId}`, path: entry.human_review?.path || '' });
    }
    if (entry.isolation) {
      index.push({ handle: `isolation:${runId}`, kind: 'isolation', label: `隔离信息 ${runId}`, path: entry.isolation?.path || '' });
    }
    if (entry.browser) {
      index.push({ handle: `browser:${runId}`, kind: 'browser', label: `浏览器证据 ${runId}`, path: entry.browser?.path || '' });
    }
    if (entry.revision) {
      index.push({
        handle: `revision:${runId}`,
        kind: 'stage-log',
        label: `视觉反馈修订血缘 ${runId}`,
        path: entry.revision?.path || '',
      });
    }
  }
  return index;
}

function buildDataProvenance(entries) {
  const inputs = entries.map(entry => {
    const input = {
      run_id: runIdOf(entry),
      case_id: caseIdOf(entry),
      model_label: modelLabel(entry),
      demo: Boolean(entry.demo),
      has_human_review: Boolean(entry.human_review),
      has_evaluator: Boolean(entry.evaluator),
      accepted: Boolean(entry.human_review
        && ['accepted', 'accepted-with-fixes'].includes(entry.human_review.decision)),
    };
    if (entry.revision?.parent_run_id) {
      input.parent_run_id = entry.revision.parent_run_id;
      input.revision_index = entry.revision.revision_index || 1;
    }
    return input;
  });
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
      title: '形成管理结论前先完成人工评审',
      priority: 'now',
      rationale: '没有人工评审，报告无法计算可验收交付率和有效提效倍数。',
    });
  }
  if (evidenceCompleteness.missing.includes('evaluator')) {
    actions.push({
      title: '对每次运行执行确定性自动评估',
      priority: 'now',
      rationale: '当前 P0 状态来自不完整证据。',
    });
  }
  if (verdict === 'replaceable-delivery') {
    actions.push({
      title: '在有限范围内试点，并保留常规评审',
      priority: 'next',
      rationale: '当前判断已达到可替代交付，试点评审稳定后再扩大范围。',
    });
  } else if (verdict === 'high-value-assist') {
    actions.push({
      title: '将候选模型定位为高价值助手，而非直接替代',
      priority: 'next',
      rationale: '收益主要集中在首版产出，需求收敛和视觉评审仍需人工参与。',
    });
  } else if (verdict === 'limited-assist') {
    actions.push({
      title: '保持探索性使用并继续调优',
      priority: 'next',
      rationale: '返工成本仍占主导，暂不要进入正式交付链路。',
    });
  } else {
    actions.push({
      title: '暂不依据本报告改变主流程',
      priority: 'next',
      rationale: '当前证据不足或质量尚不稳定。',
    });
  }
  if (humanTouch.source === 'partial') {
    actions.push({
      title: '补齐缺失的人工评审记录',
      priority: 'watch',
      rationale: '人工介入时间不完整，可能低估返工。',
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
      summary: `报告 ${reportId} 已生成：${viewKind} 视图，共 ${entries.length} 次运行。`,
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
    return `单次运行报告 · ${modelLabel(entry)} · ${caseIdOf(entry)}`;
  }
  if (viewKind === 'case-models') {
    return `模型对比报告 · Case ${caseIds.join(', ')}`;
  }
  return `Case 覆盖报告 · 模型 ${modelLabels.join(', ')}`;
}
