// High-level evaluator lifecycle.
//
// A "Case Evaluator" is an object:
//
//   {
//     caseId,                   // stable identifier
//     rubric,                   // already-parsed rubric structure
//     checks: [defineCheck...], // ordered list of assertions
//     prepare(ctx) -> artifacts // optional: build fixtures, return artifact map
//   }
//
// runEvaluation(caseEvaluator, options) drives the lifecycle:
//
//   prepare → for each check: runCheck → scoreEvaluation → createEvidenceBundle
//
// It never aborts on a single check failure: every check is attempted so
// the scorecard captures the full picture. Only dependency-ordered skips
// short-circuit individual assertions.

import { defineCheck, createExecutionContext } from './check.mjs';
import { runCheck } from './runner.mjs';
import { scoreEvaluation } from './scoring.mjs';
import { createEvidenceBundle } from './evidence.mjs';

export async function runEvaluation(caseEvaluator, options = {}) {
  if (!caseEvaluator || typeof caseEvaluator !== 'object') {
    throw new TypeError('runEvaluation: caseEvaluator is required.');
  }
  if (!Array.isArray(caseEvaluator.checks) || caseEvaluator.checks.length === 0) {
    throw new TypeError('runEvaluation: caseEvaluator.checks must be a non-empty array.');
  }
  if (!caseEvaluator.rubric || typeof caseEvaluator.rubric !== 'object') {
    throw new TypeError('runEvaluation: caseEvaluator.rubric is required.');
  }

  const checks = caseEvaluator.checks.map(defineCheck);
  guardUniqueIds(checks);
  guardRubricCoverage(checks, caseEvaluator.rubric);

  const startedAt = new Date().toISOString();
  const artifacts = typeof caseEvaluator.prepare === 'function'
    ? (await caseEvaluator.prepare(options.context || {}) || {})
    : {};
  const ctx = createExecutionContext({
    runId: options.runId || caseEvaluator.runId || null,
    caseId: caseEvaluator.caseId || options.caseId || null,
    workspace: options.workspace || null,
    artifacts,
    env: options.env || {},
    abortSignal: options.abortSignal || null,
    logger: options.logger || null,
  });

  const dependencyStatus = new Map();
  const results = [];
  const runStarted = Date.now();
  const runTimeoutMs = options.runTimeoutMs || 30 * 60_000;

  for (const check of checks) {
    const elapsed = Date.now() - runStarted;
    const remaining = runTimeoutMs - elapsed;
    if (remaining <= 0) {
      results.push(skippedDueToBudget(check));
      dependencyStatus.set(check.id, 'skipped');
      continue;
    }
    const result = await runCheck(check, ctx, {
      logsDir: options.logsDir || options.workspace || process.cwd(),
      cwd: options.workspace || null,
      dependencyStatus,
      beforeRun: options.beforeRun,
      afterRun: options.afterRun,
    });
    const decorated = decorateResult(check, result);
    results.push(decorated);
    dependencyStatus.set(check.id, decorated.status);
  }

  const scorecard = scoreEvaluation(results, caseEvaluator.rubric, options.scoring);
  const bundle = createEvidenceBundle({
    runId: ctx.runId,
    caseId: ctx.caseId,
    results,
    scorecard,
    startedAt,
    completedAt: new Date().toISOString(),
    notes: caseEvaluator.notes || options.notes || null,
  });

  return {
    status: scorecard.status,
    summary: scorecard.summary,
    next_actions: scorecard.next_actions,
    artifacts: collectArtifacts(results, options.logsDir),
    bundle,
    scorecard,
  };
}

function skippedDueToBudget(check) {
  return {
    check_id: check.id,
    status: 'skipped',
    reason: 'run budget exhausted before this check started',
    evidence: null,
    artifacts: [],
    command: null,
    exit_code: null,
    stdout_path: null,
    stderr_path: null,
    duration_ms: 0,
    failure_source: 'evaluator',
    level: check.level,
    category: check.category,
    hard_gate: check.hard_gate,
  };
}

function decorateResult(check, result) {
  return {
    ...result,
    level: result.level || check.level,
    category: result.category || check.category,
    hard_gate: result.hard_gate !== undefined ? result.hard_gate : check.hard_gate,
  };
}

function collectArtifacts(results, logsDir) {
  const artifacts = new Set();
  if (logsDir) artifacts.add(logsDir);
  for (const result of results) {
    if (result.stdout_path) artifacts.add(result.stdout_path);
    if (result.stderr_path) artifacts.add(result.stderr_path);
    for (const artifact of result.artifacts || []) artifacts.add(artifact);
  }
  return [...artifacts].sort();
}

function guardUniqueIds(checks) {
  const seen = new Set();
  for (const check of checks) {
    if (seen.has(check.id)) {
      throw new Error(`runEvaluation: duplicate check id "${check.id}".`);
    }
    seen.add(check.id);
  }
}

function guardRubricCoverage(checks, rubric) {
  if (!rubric || rubric.version !== 1 || !rubric.categories) return;
  const declared = new Set(checks.map(c => c.id));
  const missing = [];
  for (const [categoryName, category] of Object.entries(rubric.categories)) {
    for (const checkId of category.checks || []) {
      if (!declared.has(checkId)) {
        missing.push(`${categoryName}/${checkId}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(`runEvaluation: rubric checks missing from evaluator: ${missing.join(', ')}`);
  }
}

// Helper used by case evaluators to declare their checks without depending
// on the underlying defineCheck import shape.
export function declareCheck(definition) {
  return defineCheck(definition);
}
