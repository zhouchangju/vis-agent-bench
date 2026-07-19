// Deterministic scoring: weights, caps, hard gates, and total.
//
// Scoring is intentionally pure: given a list of normalised CheckResults and
// a Rubric definition, it returns a Scorecard. No I/O, no side effects.
// Case evaluators compose their own assertions and call into here.

import { isHarnessFault, isStatus, STATUS } from './status.mjs';

// A Rubric is the small subset of case/rubric.yaml we depend on. We accept
// both shapes already produced by the contract layer:
//
//   - legacy { weights, gates: { p0_min_score, critical_failure_cap }, levels }
//   - v1     { version: 1, total: 100, hard_gates, categories, caps }
//
// Evaluator Core never reads YAML directly; case evaluators or the
// orchestrator parse and hand the structure in.
export function normaliseRubric(rubric) {
  if (!rubric || typeof rubric !== 'object') {
    throw new TypeError('normaliseRubric: rubric must be an object.');
  }
  if (rubric.version === 1 && rubric.total === 100 && rubric.categories) {
    return normaliseV1Rubric(rubric);
  }
  if (rubric.weights && rubric.gates) {
    return normaliseLegacyRubric(rubric);
  }
  throw new TypeError('normaliseRubric: rubric shape is neither v1 nor legacy.');
}

function normaliseV1Rubric(rubric) {
  const hardGates = new Set(rubric.hard_gates || []);
  const categories = {};
  for (const [name, def] of Object.entries(rubric.categories)) {
    categories[name] = {
      weight: def.weight,
      checks: [...(def.checks || [])],
    };
  }
  return {
    version: 1,
    total: 100,
    hardGates,
    categories,
    caps: { ...(rubric.caps || {}) },
    p0_min_score: 0,
    legacy: false,
  };
}

function normaliseLegacyRubric(rubric) {
  // Legacy rubrics do not enumerate hard gate check ids; we treat P0
  // checks as hard gates when their level is p0. categories are synthesised
  // from weights so the v1 scorer can be reused.
  const categories = {};
  for (const [name, weight] of Object.entries(rubric.weights)) {
    categories[name] = { weight, checks: [] };
  }
  return {
    version: 1,
    total: 100,
    hardGates: new Set(),
    categories,
    caps: { critical_failure_cap: rubric.gates?.critical_failure_cap ?? 0 },
    p0_min_score: rubric.gates?.p0_min_score ?? 0,
    legacy: true,
  };
}

// Compute a scorecard. Rules (frozen by EVALUATOR_PROTOCOL):
//
//   1. Each check contributes to its category's score only when executed
//      (status pass / fail / warning). Skipped and error checks score 0 and
//      mark the category as incomplete.
//   2. A category's earned weight is the fraction of executed-and-passing
//      checks, scaled by warning severity (warnings count half), times the
//      category weight.
//   3. If any check for a category did not run (skipped or error), the
//      category is marked `incomplete` and its raw score is held to 0; the
//      scorecard cannot report a total above the `incomplete_cap`.
//   4. Hard gates and P0 failures apply a cap on the final total. Caps do
//      not stack additively — the lowest applicable cap wins.
//   5. A run with any harness error is reported as status `error`; the
//      scorecard still carries partial scores for diagnosis but the run is
//      not eligible for acceptance.
export function scoreEvaluation(results, rubricInput, options = {}) {
  if (!Array.isArray(results)) {
    throw new TypeError('scoreEvaluation: results must be an array.');
  }
  const rubric = normaliseRubric(rubricInput);
  const indexed = indexResults(results);
  const duplicateIds = detectDuplicateIds(results);

  const executedChecks = new Set();
  const failingHardGates = [];
  const failingP0 = [];
  const harnessErrors = [];
  const skipped = [];
  const unrunRubricChecks = [];

  for (const result of results) {
    if (!isStatus(result.status)) {
      // Defensive: runner should already have normalised this.
      result = { ...result, status: STATUS.ERROR };
    }
    if (result.status === STATUS.SKIPPED) skipped.push(result.check_id);
    if (isHarnessFault(result.status)) harnessErrors.push(result.check_id);
    if (result.status === STATUS.FAIL) {
      const meta = indexed.get(result.check_id);
      if (meta?.hard_gate) failingHardGates.push(result.check_id);
      if (meta?.level === 'p0') failingP0.push(result.check_id);
    }
    if (result.status === STATUS.PASS || result.status === STATUS.WARNING) {
      executedChecks.add(result.check_id);
    }
  }

  // Determine which rubric-declared checks never ran. This catches the
  // silent "evaluator forgot to register a check" failure mode.
  for (const [categoryName, category] of Object.entries(rubric.categories)) {
    for (const checkId of category.checks) {
      const ran = results.some(r => r.check_id === checkId
        && (r.status === STATUS.PASS || r.status === STATUS.WARNING || r.status === STATUS.FAIL));
      if (!ran) unrunRubricChecks.push({ category: categoryName, check_id: checkId });
    }
  }

  const categoryScores = {};
  let rawTotal = 0;
  let anyCategoryIncomplete = false;

  for (const [categoryName, category] of Object.entries(rubric.categories)) {
    const relevant = results.filter(r => category.checks.includes(r.check_id));
    const result = scoreCategory(category, relevant, options);
    categoryScores[categoryName] = result;
    rawTotal += result.score;
    if (result.incomplete) anyCategoryIncomplete = true;
  }

  const caps = selectCaps(rubric, {
    failingHardGates,
    failingP0,
    unrun: unrunRubricChecks.length + skipped.length + harnessErrors.length,
    anyCategoryIncomplete,
    options,
  });

  const cappedTotal = Math.min(rawTotal, caps.effective_cap);
  const accepted = computeAccepted({
    cappedTotal,
    rubric,
    failingHardGates,
    failingP0,
    unrun: unrunRubricChecks.length,
    harnessErrors: harnessErrors.length,
  });

  return {
    status: accepted.status,
    summary: buildSummary({ accepted, failingHardGates, failingP0, unrun: unrunRubricChecks, harnessErrors }),
    total: round1(cappedTotal),
    raw_total: round1(rawTotal),
    effective_cap: caps.effective_cap,
    applied_caps: caps.applied,
    categories: categoryScores,
    hard_gates: {
      declared: [...rubric.hardGates],
      failing: [...new Set(failingHardGates)],
    },
    p0: {
      min_score: rubric.p0_min_score,
      failing: [...new Set(failingP0)],
    },
    completeness: {
      executed: [...executedChecks].sort(),
      skipped: [...new Set(skipped)].sort(),
      harness_errors: [...new Set(harnessErrors)].sort(),
      unrun_rubric_checks: unrunRubricChecks,
      duplicate_check_ids: duplicateIds,
    },
    next_actions: buildNextActions({ accepted, failingHardGates, failingP0, unrun: unrunRubricChecks, harnessErrors, duplicateIds }),
  };
}

function indexResults(results) {
  const map = new Map();
  for (const result of results) {
    map.set(result.check_id, {
      hard_gate: result.hard_gate === true || result.hard_gate === 'true',
      level: result.level || null,
    });
  }
  return map;
}

function detectDuplicateIds(results) {
  const seen = new Map();
  const duplicates = new Set();
  for (const result of results) {
    const count = (seen.get(result.check_id) || 0) + 1;
    seen.set(result.check_id, count);
    if (count === 2) duplicates.add(result.check_id);
  }
  return [...duplicates].sort();
}

// Category scoring. A category with zero declared checks is reported as
// incomplete — the rubric promised checks the evaluator never declared.
function scoreCategory(category, results, options) {
  const expected = category.checks.length;
  const relevant = results.filter(r => category.checks.includes(r.check_id));

  const counts = { pass: 0, fail: 0, warning: 0, skipped: 0, error: 0 };
  for (const result of relevant) {
    if (counts[result.status] != null) counts[result.status] += 1;
  }

  const declared = expected;
  const ran = counts.pass + counts.fail + counts.warning;
  const unrun = declared - ran;
  const incomplete = unrun > 0 || counts.skipped > 0 || counts.error > 0;

  const weights = options.warningWeight != null ? options.warningWeight : 0.5;
  const denominator = declared || 1;
  const earned = counts.pass + counts.warning * weights;
  const rawFraction = earned / denominator;
  const score = incomplete ? 0 : rawFraction * category.weight;

  return {
    weight: category.weight,
    score: round1(score),
    raw_fraction: round1(rawFraction),
    counts,
    declared,
    ran,
    unrun,
    incomplete,
    checks: relevant.map(r => ({
      check_id: r.check_id,
      status: r.status,
      reason: r.reason || null,
      duration_ms: r.duration_ms || 0,
      failure_source: r.failure_source || null,
    })),
  };
}

// Determine which caps apply. Caps are a maximum score; the minimum cap
// wins because it represents the most severe constraint.
function selectCaps(rubric, ctx) {
  const applied = [];
  let cap = rubric.total;

  if (ctx.failingHardGates.length > 0) {
    const hardCap = ctx.options.hardGateCap != null ? ctx.options.hardGateCap : 0;
    applied.push({ kind: 'hard_gate', cap: hardCap, reason: `${ctx.failingHardGates.length} hard gate failure(s)` });
    cap = Math.min(cap, hardCap);
  }

  if (ctx.failingP0.length > 0) {
    const p0Cap = rubric.caps?.p0_failure_max_score
      ?? rubric.caps?.critical_failure_cap
      ?? ctx.options.p0Cap
      ?? 0;
    applied.push({ kind: 'p0_failure', cap: p0Cap, reason: `${ctx.failingP0.length} P0 failure(s)` });
    cap = Math.min(cap, p0Cap);
  }

  if (ctx.unrun > 0 || ctx.anyCategoryIncomplete) {
    const incompleteCap = ctx.options.incompleteCap != null ? ctx.options.incompleteCap : 0;
    applied.push({ kind: 'incomplete', cap: incompleteCap, reason: `${ctx.unrun} check(s) did not run` });
    cap = Math.min(cap, incompleteCap);
  }

  // Explicit, named caps from the rubric take effect when their trigger
  // fires. For v1 rubrics we currently use them directly via fail-family
  // caps; case evaluators can pass extra triggers through options.caps.
  const namedCaps = ctx.options.caps || rubric.caps || {};
  for (const [trigger, limit] of Object.entries(namedCaps)) {
    if (trigger === 'critical_failure_cap' || trigger === 'p0_failure_max_score') continue;
    if (ctx.options.capTriggers?.[trigger]) {
      applied.push({ kind: 'named', trigger, cap: limit });
      cap = Math.min(cap, limit);
    }
  }

  return { effective_cap: cap, applied };
}

function computeAccepted(ctx) {
  // Hard gate failures and harness errors are non-negotiable.
  if (ctx.failingHardGates.length > 0) {
    return { status: 'error', decision: 'rejected', reason: 'hard gate failure' };
  }
  if (ctx.harnessErrors > 0) {
    return { status: 'error', decision: 'invalid-run', reason: 'harness error' };
  }
  if (ctx.unrun > 0) {
    return { status: 'error', decision: 'invalid-run', reason: 'rubric checks never ran' };
  }
  if (ctx.failingP0.length > 0) {
    return { status: 'warning', decision: 'partial', reason: 'P0 failure(s)' };
  }
  return {
    status: ctx.cappedTotal >= ctx.rubric.p0_min_score ? 'success' : 'warning',
    decision: ctx.cappedTotal >= ctx.rubric.p0_min_score ? 'accepted' : 'partial',
    reason: 'all checks ran',
  };
}

function buildSummary(ctx) {
  const parts = [];
  if (ctx.failingHardGates.length) parts.push(`${ctx.failingHardGates.length} hard gate failure(s)`);
  if (ctx.failingP0.length) parts.push(`${ctx.failingP0.length} P0 failure(s)`);
  if (ctx.unrun.length) parts.push(`${ctx.unrun.length} rubric check(s) never ran`);
  if (ctx.harnessErrors.length) parts.push(`${ctx.harnessErrors.length} harness error(s)`);
  if (!parts.length) parts.push('all checks executed');
  return `Evaluator core: ${parts.join('; ')}.`;
}

function buildNextActions(ctx) {
  const actions = [];
  for (const id of ctx.failingHardGates) actions.push(`Resolve hard gate failure: ${id}.`);
  for (const id of ctx.failingP0) actions.push(`Fix P0 failure: ${id}.`);
  for (const entry of ctx.unrun) actions.push(`Run missing rubric check: ${entry.category}/${entry.check_id}.`);
  for (const id of ctx.harnessErrors) actions.push(`Investigate evaluator crash: ${id}.`);
  for (const id of ctx.duplicateIds) actions.push(`De-duplicate check id: ${id}.`);
  if (!actions.length) actions.push('No blocking actions; ready for human review.');
  return actions;
}

function round1(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}
