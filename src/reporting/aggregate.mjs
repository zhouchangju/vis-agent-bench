// Aggregation primitives for the VAB-T07 reporting pipeline.
//
// This module never executes a model, browser or evaluator. It only re-shapes
// already collected evidence (Run result, evaluator output, human review and an
// optional human-only baseline) into the structured fields consumed by the
// report builder. Every function is pure and returns plain JSON so callers can
// snapshot test it.

const HUMAN_TIME_KEYS = [
  'clarification_minutes',
  'context_prep_minutes',
  'poc_review_minutes',
  'micro_adjustment_minutes',
  'fix_minutes',
  'final_review_minutes',
];

const ACCEPTED_DECISIONS = new Set(['accepted', 'accepted-with-fixes']);

const VERDICT_RANK = {
  'replaceable-delivery': 3,
  'high-value-assist': 2,
  'limited-assist': 1,
  'not-applicable': 0,
};

const P0_RANK = { passed: 3, partial: 2, failed: 1, unknown: 0 };

export function isAcceptedRun(entry) {
  const decision = entry?.human_review?.decision;
  if (decision) return ACCEPTED_DECISIONS.has(decision);
  // Aggregated views (case-models, model-cases) carry a reduced decision field.
  if (entry?.decision) return ACCEPTED_DECISIONS.has(entry.decision);
  return false;
}

export function modelLabel(entry) {
  const engine = entry?.run?.engine || entry?.run?.spec?.engine;
  const model = engine?.configured_model || engine?.model;
  const provider = engine?.provider;
  if (model && provider) return `${provider}/${model}`;
  return model || provider || 'unspecified-model';
}

export function caseIdOf(entry) {
  return entry?.run?.case_id || entry?.run?.spec?.case_id || entry?.case_id || 'unknown-case';
}

export function runIdOf(entry) {
  return entry?.run?.run_id || entry?.run?.id || entry?.run_id || 'unknown-run';
}

// ---- Human Touch Time ------------------------------------------------------

function sumMinutes(reviews, key) {
  let total = 0;
  let contributed = 0;
  for (const review of reviews) {
    const minutes = review?.human_time?.[key];
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0) {
      total += minutes;
      contributed += 1;
    }
  }
  return { total, contributed };
}

export function aggregateHumanTouchTime(entries) {
  const reviews = entries
    .filter(entry => entry?.human_review?.reviews?.length)
    .flatMap(entry => entry.human_review.reviews);
  const totalReviews = reviews.length;

  const breakdown = {};
  let grandTotal = 0;
  for (const key of HUMAN_TIME_KEYS) {
    const { total, contributed } = sumMinutes(reviews, key);
    breakdown[key] = contributed > 0 ? total : null;
    if (contributed > 0) grandTotal += total;
  }

  return {
    ...breakdown,
    total_minutes: totalReviews > 0 ? grandTotal : null,
    source: humanTouchSource(entries, totalReviews),
  };
}

function humanTouchSource(entries, reviewedRuns) {
  const runCount = entries.length;
  if (reviewedRuns === 0) return 'unavailable';
  if (reviewedRuns < runCount) return 'partial';
  return 'human-review';
}

// ---- Accepted delivery rate ------------------------------------------------

export function acceptedDeliveryRate(entries) {
  // Each entry may have a flat decision (normalized) or a reviews[] array
  // (raw package). We pull one decision per entry, picking the best from
  // the reviews array when multiple exist.
  const decisions = [];
  for (const entry of entries) {
    const hr = entry?.human_review;
    if (!hr) continue;
    // Normalized shape (as produced by normalizeEntry in builders.mjs).
    if (typeof hr.decision === 'string') {
      decisions.push(hr.decision);
      continue;
    }
    // Raw shape: iterate reviews array.
    if (Array.isArray(hr.reviews)) {
      const reviewDecisions = hr.reviews
        .map(r => r.decision)
        .filter(d => typeof d === 'string');
      if (reviewDecisions.length > 0) {
        decisions.push(reviewDecisions[0]); // one decision per run-entry
      }
    }
  }
  const accepted = decisions.filter(d => ACCEPTED_DECISIONS.has(d));
  const source = decisions.length > 0 ? 'human-review' : 'unavailable';
  const percent = decisions.length > 0
    ? Math.round((accepted.length / decisions.length) * 100)
    : null;
  return { percent, accepted: accepted.length, reviewed: decisions.length, source };
}

// ---- P0 state --------------------------------------------------------------

export function p0StateFromEvaluator(evaluator) {
  if (!evaluator) return 'unknown';
  const summary = evaluator.summary || evaluator.result || {};
  const gates = summary.gates || evaluator.gates;
  if (gates && typeof gates === 'object') {
    if (gates.p0_passed === true) return 'passed';
    if (gates.p0_failed === true) return 'failed';
  }
  if (typeof summary.p0_state === 'string') return summary.p0_state;
  if (typeof summary.score === 'number' && typeof summary.p0_min_score === 'number') {
    return summary.score >= summary.p0_min_score ? 'passed' : 'failed';
  }
  if (typeof summary.p0_passed === 'boolean') return summary.p0_passed ? 'passed' : 'failed';
  return 'unknown';
}

export function decideP0State(entries) {
  if (entries.length === 0) return 'unknown';
  let best = 'unknown';
  for (const entry of entries) {
    const state = entry?.human_review?.p0_state
      || p0StateFromEvaluator(entry?.evaluator)
      || 'unknown';
    if (P0_RANK[state] > P0_RANK[best]) best = state;
  }
  return best;
}

// ---- Effective speedup -----------------------------------------------------

export function computeEffectiveSpeedup(entries, baseline) {
  const acceptedEntries = entries.filter(entry => isAcceptedRun(entry));
  if (acceptedEntries.length === 0 || !baseline) {
    return {
      ratio: null,
      baseline_minutes: baseline?.total_minutes ?? null,
      candidate_minutes: acceptedEntries.length > 0
        ? acceptedEntries.reduce((sum, entry) => {
          const v = entry?.human_review?.human_time_total_minutes;
          return sum + (typeof v === 'number' ? v : 0);
        }, 0) || null
        : null,
      source: !baseline ? 'baseline-missing' : 'unavailable',
      eligible: false,
    };
  }

  const candidateMinutes = acceptedEntries.reduce((sum, entry) => {
    const value = entry?.human_review?.human_time_total_minutes;
    return sum + (typeof value === 'number' ? value : 0);
  }, 0);

  const baselineMinutes = baseline?.total_minutes;
  const ratio = baselineMinutes && baselineMinutes > 0 && candidateMinutes > 0
    ? Number((baselineMinutes / candidateMinutes).toFixed(2))
    : null;

  return {
    ratio,
    baseline_minutes: baselineMinutes ?? null,
    candidate_minutes: candidateMinutes || null,
    source: 'human-review',
    eligible: true,
  };
}

// ---- Cost ------------------------------------------------------------------

function addIfNumber(target, key, value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    target[key] = (target[key] || 0) + value;
    return true;
  }
  return false;
}

export function summarizeCost(entries) {
  const tokenTotals = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
  let tokenContributions = 0;
  let costTotal = 0;
  let costContributions = 0;
  let runsReporting = 0;
  let runsAnything = 0;

  for (const entry of entries) {
    const usage = entry?.run?.usage || entry?.evaluator?.usage;
    if (!usage) continue;
    runsAnything += 1;
    const inputOk = addIfNumber(tokenTotals, 'input_tokens', usage.input_tokens);
    const outputOk = addIfNumber(tokenTotals, 'output_tokens', usage.output_tokens);
    const cachedOk = addIfNumber(tokenTotals, 'cached_tokens', usage.cached_tokens);
    if (inputOk || outputOk || cachedOk) tokenContributions += 1;
    if (typeof usage.cost_usd === 'number' && Number.isFinite(usage.cost_usd) && usage.cost_usd >= 0) {
      costTotal += usage.cost_usd;
      costContributions += 1;
    }
    if (usage.availability === 'reported' || usage.availability === 'partial') runsReporting += 1;
  }

  const availability = costContributions === 0 && tokenContributions === 0
    ? 'unavailable'
    : (costContributions < entries.length || tokenContributions < entries.length ? 'partial' : 'reported');

  return {
    availability,
    reported_cost_usd: costContributions > 0 ? Number(costTotal.toFixed(6)) : null,
    reported_tokens: tokenContributions > 0 ? tokenTotals : null,
    currency_note: buildCurrencyNote(entries.length, costContributions, tokenContributions, runsAnything),
  };
}

function buildCurrencyNote(totalRuns, costRuns, tokenRuns, reportingRuns) {
  const parts = [];
  if (costRuns === 0) parts.push('CLI 未上报精确美元费用。');
  else parts.push(`${costRuns}/${totalRuns} 次运行上报了精确美元费用。`);
  if (tokenRuns > 0) parts.push(`${tokenRuns}/${totalRuns} 次运行上报了 Token 用量。`);
  else parts.push('CLI 未上报 Token 用量。');
  if (reportingRuns < totalRuns) {
    const missing = totalRuns - reportingRuns;
    parts.push(`${missing} 次运行没有用量事件；缺失值按“暂无”处理，不进行估算。`);
  }
  return parts.join(' ');
}

// ---- Fact layering ---------------------------------------------------------

export function buildFactLayers(entries, aggregates) {
  const layers = { machine: [], human: [], inferred: [], unverified: [] };
  let machineIndex = 0;
  let humanIndex = 0;
  let inferredIndex = 0;
  let unverifiedIndex = 0;

  const push = (layer, source, statement, evidenceRefs = []) => {
    const index = { machine: machineIndex, human: humanIndex, inferred: inferredIndex, unverified: unverifiedIndex }[layer];
    const prefix = { machine: 'M', human: 'H', inferred: 'I', unverified: 'U' }[layer];
    const id = `${prefix}${String(index + 1).padStart(2, '0')}`;
    const record = { id, source, statement };
    if (evidenceRefs.length) record.evidence_refs = evidenceRefs;
    layers[layer].push(record);
    if (layer === 'machine') machineIndex += 1;
    else if (layer === 'human') humanIndex += 1;
    else if (layer === 'inferred') inferredIndex += 1;
    else unverifiedIndex += 1;
    return id;
  };

  for (const entry of entries) {
    const runId = runIdOf(entry);
    const run = entry?.run || {};
    const evaluator = entry?.evaluator;
    const review = entry?.human_review;
    const revision = entry?.revision;

    if (run?.status) {
      push('machine', 'machine', `运行 ${runId} 的最终状态为 ${run.status}。`, [`run:${runId}`]);
    }
    if (run?.duration_ms != null) {
      push('machine', 'machine', `运行 ${runId} 的 CLI 墙钟时间为 ${Math.round(run.duration_ms / 60000)} 分钟。`, [`run:${runId}`]);
    }
    if (revision?.parent_run_id) {
      push(
        'machine',
        'machine',
        `运行 ${runId} 是父 Run ${revision.parent_run_id} 的第 ${revision.revision_index || 1} 次视觉反馈修订；使用新会话并复用父 Run 代码快照。`,
        [`revision:${runId}`],
      );
    }
    if (evaluator) {
      const p0 = p0StateFromEvaluator(evaluator);
      push('machine', 'machine', `自动评估器记录运行 ${runId} 的 P0 状态为 ${p0}。`, [`evaluator:${runId}`]);
    } else {
      push('unverified', 'unverified', `运行 ${runId} 缺少自动评估输出，P0 状态未知。`, [`run:${runId}`]);
    }

    if (review?.decision) {
      push('human', 'human', `评审人将运行 ${runId} 标记为 ${review.decision}。`, [`human-review:${runId}`]);
    }
    if (review?.observations?.management_judgment) {
      push('human', 'human', review.observations.management_judgment, [`human-review:${runId}`]);
    }
  }

  // Aggregated inferences (clearly flagged as derived, not measured).
  if (aggregates.accepted_delivery_rate.percent != null) {
    const r = aggregates.accepted_delivery_rate;
    push('inferred', 'inferred', `可验收交付率为 ${r.percent}%（${r.accepted}/${r.reviewed} 次已评审运行）。`);
  } else {
    push('inferred', 'inferred', '至少完成一次人工评审后，才能计算可验收交付率。');
  }
  if (aggregates.effective_speedup.eligible && aggregates.effective_speedup.ratio != null) {
    const s = aggregates.effective_speedup;
    push('inferred', 'inferred', `有效提效倍数为 ${s.ratio}×（人工基线 ${s.baseline_minutes} 分钟 / AI 协作 ${s.candidate_minutes} 分钟，仅统计已验收运行）。`);
  } else {
    push('inferred', 'inferred', '尚无运行通过验收，暂不能计算有效提效倍数。');
  }

  return layers;
}

// ---- Case conclusions ------------------------------------------------------

function pickReviewForDecision(entries) {
  // Prefer accepted > accepted-with-fixes > partial > rejected > invalid-run,
  // mirroring human-review.schema.json enum order of severity.
  const order = ['accepted', 'accepted-with-fixes', 'partial', 'rejected', 'invalid-run'];
  let best = null;
  let bestIdx = order.length;
  for (const entry of entries) {
    const decision = entry?.human_review?.decision;
    if (!decision) continue;
    const idx = order.indexOf(decision);
    if (idx >= 0 && idx < bestIdx) {
      best = entry;
      bestIdx = idx;
    }
  }
  return best || entries[0] || null;
}

export function buildCaseConclusion(caseId, entries, caseMeta) {
  const decision = aggregateDecision(entries);
  const p0State = decideP0State(entries);
  const review = pickReviewForDecision(entries);
  const judgment = deriveJudgment(decision, p0State, review);
  const conclusion = {
    case_id: caseId,
    title: caseMeta?.title || caseId,
    decision,
    p0_state: p0State,
    judgment,
    scores: review?.scores || null,
    detail: review?.observations?.problems || review?.observations?.strengths || '',
    evidence_refs: entries.map(entry => `run:${runIdOf(entry)}`),
  };
  return conclusion;
}

function aggregateDecision(entries) {
  if (entries.length === 0) return null;
  const decisions = new Set(entries.map(entry => entry?.human_review?.decision).filter(Boolean));
  if (decisions.size === 0) return null;
  if (decisions.size === 1) return [...decisions][0];
  return 'mixed';
}

function deriveJudgment(decision, p0State, review) {
  if (decision && ACCEPTED_DECISIONS.has(decision) && p0State === 'passed') return 'replaceable-delivery';
  if (decision === 'accepted-with-fixes' || p0State === 'partial') return 'high-value-assist';
  if (decision === 'partial' || p0State === 'failed') return 'limited-assist';
  if (decision === 'rejected' || decision === 'invalid-run') return 'not-applicable';
  if (review?.observations?.management_judgment) return 'limited-assist';
  return 'unknown';
}

// ---- Capability boundaries -------------------------------------------------

export function buildCapabilityBoundaries(caseConclusions) {
  const byJudgment = new Map();
  for (const conclusion of caseConclusions) {
    const judgment = conclusion.judgment || 'unknown';
    if (!byJudgment.has(judgment)) byJudgment.set(judgment, []);
    byJudgment.get(judgment).push(conclusion);
  }

  const boundaries = [];
  for (const [judgment, conclusions] of byJudgment.entries()) {
    boundaries.push({
      scope: conclusions.map(c => c.case_id).join(', '),
      judgment,
      detail: describeJudgment(judgment, conclusions),
      evidence_refs: conclusions.flatMap(c => c.evidence_refs),
    });
  }
  return boundaries.sort((a, b) => (VERDICT_RANK[b.judgment] ?? -1) - (VERDICT_RANK[a.judgment] ?? -1));
}

function describeJudgment(judgment, conclusions) {
  const cases = conclusions.map(c => c.case_id).join(', ');
  const detail = conclusions.find(c => c.detail)?.detail || '';
  const prefix = {
    'replaceable-delivery': 'P0 稳定且已验收，人工主要承担常规评审。',
    'high-value-assist': '尚不能独立交付，但能明显减少编码或问题定位工作量。',
    'limited-assist': '返工仍占主导，提效集中在局部环节。',
    'not-applicable': '质量不稳定，或人工接管成本接近原始基线。',
    'unknown': '尚无已评审运行，无法判断能力边界。',
  }[judgment] || '现有证据不足以判断能力边界。';
  return `${prefix}${detail ? ` ${detail}` : ''}（Cases：${cases}）`;
}

// ---- Failure modes ---------------------------------------------------------

export function buildFailureModes(entries, caseConclusions) {
  const failures = [];

  for (const entry of entries) {
    const runId = runIdOf(entry);
    const runStatus = entry?.run?.status;
    if (runStatus && runStatus !== 'success') {
      failures.push({
        title: `运行 ${runId} 未正常完成（状态：${runStatus}）`,
        detail: entry?.run?.error?.root_cause_hint || 'CLI 运行未成功结束，请检查阶段日志。',
        source: 'machine',
        evidence_refs: [`run:${runId}`],
      });
    }
    const review = entry?.human_review;
    if (review?.observations?.problems) {
      failures.push({
        title: `评审人报告运行 ${runId} 存在问题`,
        detail: review.observations.problems,
        source: 'human',
        evidence_refs: [`human-review:${runId}`],
      });
    }
    if (review?.observations?.required_fixes) {
      failures.push({
        title: `运行 ${runId} 记录了必须修复项`,
        detail: review.observations.required_fixes,
        source: 'human',
        evidence_refs: [`human-review:${runId}`],
      });
    }
    if (entry?.evaluator?.failures?.length) {
      failures.push({
        title: `自动评估器在运行 ${runId} 中标记了 ${entry.evaluator.failures.length} 个问题`,
        detail: entry.evaluator.failures.map(f => f.message || f).join('; '),
        source: 'machine',
        evidence_refs: [`evaluator:${runId}`],
      });
    }
  }

  for (const conclusion of caseConclusions) {
    if (conclusion.p0_state === 'failed' || conclusion.decision === 'rejected' || conclusion.decision === 'invalid-run') {
      failures.push({
        title: `Case ${conclusion.case_id} 未达到验收条件`,
        detail: conclusion.detail || `P0 状态：${conclusion.p0_state}；人工决策：${conclusion.decision || '无'}。`,
        source: 'inferred',
        evidence_refs: conclusion.evidence_refs,
      });
    }
  }

  // De-duplicate by title so a run that fails CLI and is rejected by reviewer does not flood.
  const seen = new Set();
  return failures.filter(failure => {
    if (seen.has(failure.title)) return false;
    seen.add(failure.title);
    return true;
  });
}

// ---- Evidence completeness -------------------------------------------------

const REQUIRED_EVIDENCE_FOR_FULL_REPORT = ['run', 'evaluator', 'human-review', 'isolation'];

export function computeEvidenceCompleteness(entries) {
  const present = new Set();
  const missing = new Set(REQUIRED_EVIDENCE_FOR_FULL_REPORT);
  for (const entry of entries) {
    if (entry?.run) { present.add('run'); missing.delete('run'); }
    if (entry?.evaluator) { present.add('evaluator'); missing.delete('evaluator'); }
    if (entry?.human_review) { present.add('human-review'); missing.delete('human-review'); }
    if (entry?.isolation) { present.add('isolation'); missing.delete('isolation'); }
    if (entry?.baseline) present.add('baseline');
    if (entry?.browser) present.add('browser');
  }
  const requiredPresent = REQUIRED_EVIDENCE_FOR_FULL_REPORT.filter(kind => present.has(kind)).length;
  const percent = Math.round((requiredPresent / REQUIRED_EVIDENCE_FOR_FULL_REPORT.length) * 100);
  return {
    percent,
    present: [...present].sort(),
    missing: [...missing].sort(),
  };
}

// ---- Verdict ---------------------------------------------------------------

export function deriveVerdict(caseConclusions, speedup) {
  if (caseConclusions.length === 0) return 'not-applicable';
  const judgments = new Set(caseConclusions.map(c => c.judgment).filter(j => j && j !== 'unknown'));
  if (judgments.size === 0) return 'not-applicable';
  const best = [...judgments].sort((a, b) => (VERDICT_RANK[b] ?? -1) - (VERDICT_RANK[a] ?? -1))[0];
  // Effective speedup that is not eligible downgrades leadership verdict.
  if (!speedup.eligible && best === 'replaceable-delivery') return 'high-value-assist';
  return best;
}

export function deriveHeadline(verdict, speedup, acceptedRate) {
  let speedText;
  if (speedup.eligible && speedup.ratio != null) {
    speedText = `已验收交付的有效提效倍数为 ${speedup.ratio}×。`;
  } else if ((acceptedRate?.accepted ?? 0) === 0) {
    speedText = '尚无交付通过验收，暂不能计算有效提效倍数。';
  } else if (speedup.source === 'baseline-missing') {
    speedText = '已有交付通过验收，但缺少可比人工基线，暂不能计算有效提效倍数。';
  } else {
    speedText = '已有交付通过验收，但现有人工介入时间证据不足，暂不能计算有效提效倍数。';
  }
  const rateText = acceptedRate.percent != null
    ? `可验收交付率为 ${acceptedRate.percent}%（${acceptedRate.accepted}/${acceptedRate.reviewed}）。`
    : '人工评审完成前无法计算可验收交付率。';
  const verdictText = {
    'replaceable-delivery': '候选模型已接近可替代交付，应在扩大使用前确认适用边界。',
    'high-value-assist': '候选模型表现出高价值辅助特征，需求收敛和视觉评审仍需人工参与。',
    'limited-assist': '候选模型目前仅能有限辅助，提效集中在局部，返工仍较明显。',
    'not-applicable': '候选模型暂不适合用于交付决策，应完成人工评审后再判断。',
  }[verdict] || '现有证据不足以形成综合判断。';
  return `${verdictText} ${speedText} ${rateText}`;
}
