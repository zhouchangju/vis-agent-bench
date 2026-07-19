import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  EVALUATOR_CORE_VERSION,
  STATUS,
  attachExecutorEvidence,
  createEvidenceBundle,
  createExecutionContext,
  declareCheck,
  defineCheck,
  describeStatus,
  harnessErrorResult,
  isBlocking,
  isExecuted,
  isHarnessFault,
  isHarnessStatus,
  isPassing,
  isStatus,
  normaliseOutcome,
  normaliseRubric,
  partitionByFailureSource,
  runCheck,
  runEvaluation,
  scoreEvaluation,
  skippedResult,
  summariseBundle,
} from '../../../src/evaluators/core/index.mjs';

const results = [];
function record(name, error) {
  if (error) {
    results.push({ name, ok: false, message: error.message, stack: error.stack });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  } else {
    results.push({ name, ok: true });
    process.stdout.write(`PASS ${name}\n`);
  }
}

function check(name, fn) {
  try { fn(); record(name, null); }
  catch (error) { record(name, error); }
}

async function asyncCheck(name, fn) {
  try { await fn(); record(name, null); }
  catch (error) { record(name, error); }
}

function baseRubric() {
  return {
    version: 1,
    total: 100,
    hard_gates: ['build'],
    categories: {
      engineering: { weight: 60, checks: ['build', 'unit-tests'] },
      business: { weight: 40, checks: ['overview-renders', 'events-valid'] },
    },
    caps: { p0_failure_max_score: 49 },
  };
}

// --- status.mjs -----------------------------------------------------------

check('STATUS exposes the five canonical statuses', () => {
  assert.deepEqual(Object.values(STATUS).sort(),
    ['error', 'fail', 'pass', 'skipped', 'warning']);
});

check('isStatus rejects unknown strings', () => {
  assert.equal(isStatus('pass'), true);
  assert.equal(isStatus('done'), false);
  assert.equal(isStatus(null), false);
});

check('isExecuted differentiates ran vs harness-only', () => {
  assert.equal(isExecuted(STATUS.PASS), true);
  assert.equal(isExecuted(STATUS.FAIL), true);
  assert.equal(isExecuted(STATUS.WARNING), true);
  assert.equal(isExecuted(STATUS.SKIPPED), false);
  assert.equal(isExecuted(STATUS.ERROR), false);
});

check('isHarnessStatus flags skipped + error', () => {
  assert.equal(isHarnessStatus(STATUS.SKIPPED), true);
  assert.equal(isHarnessStatus(STATUS.ERROR), true);
  assert.equal(isHarnessStatus(STATUS.FAIL), false);
});

check('isPassing / isBlocking / isHarnessFault predicates', () => {
  assert.equal(isPassing(STATUS.PASS), true);
  assert.equal(isPassing(STATUS.WARNING), true);
  assert.equal(isPassing(STATUS.FAIL), false);
  assert.equal(isBlocking(STATUS.FAIL), true);
  assert.equal(isBlocking(STATUS.WARNING), false);
  assert.equal(isHarnessFault(STATUS.ERROR), true);
  assert.equal(isHarnessFault(STATUS.FAIL), false);
});

check('describeStatus is non-empty for every status', () => {
  for (const s of Object.values(STATUS)) {
    assert.ok(describeStatus(s).length > 0);
  }
});

// --- check.mjs ------------------------------------------------------------

check('defineCheck rejects malformed ids', () => {
  assert.throws(() => defineCheck({ id: 'Bad ID', run() {} }), TypeError);
  assert.throws(() => defineCheck({ id: 'ok', run: 'no' }), TypeError);
});

check('defineCheck rejects unknown level/kind', () => {
  assert.throws(() => defineCheck({ id: 'a', level: 'p9', run() {} }), TypeError);
  assert.throws(() => defineCheck({ id: 'a', kind: 'judge', run() {} }), TypeError);
});

check('defineCheck applies sensible defaults', () => {
  const c = defineCheck({ id: 'build', run() {} });
  assert.equal(c.kind, 'machine');
  assert.equal(c.level, 'p1');
  assert.equal(c.timeout_ms, 60_000);
  assert.equal(c.hard_gate, false);
});

check('createExecutionContext exposes artifact lookups', () => {
  const ctx = createExecutionContext({
    runId: 'r1', caseId: 'c1', workspace: '/tmp', artifacts: { fixture: '/tmp/f.json' },
  });
  assert.equal(ctx.hasArtifact('fixture'), true);
  assert.equal(ctx.getArtifact('missing'), null);
  assert.deepEqual(ctx.listArtifacts(), ['fixture']);
});

check('normaliseOutcome accepts string and object outcomes', () => {
  const c = defineCheck({ id: 'a', run() {} });
  assert.equal(normaliseOutcome(c, 'pass').status, 'pass');
  const obj = normaliseOutcome(c, { status: 'fail', reason: 'boom', artifacts: ['/x'] });
  assert.equal(obj.status, 'fail');
  assert.equal(obj.reason, 'boom');
  assert.deepEqual(obj.artifacts, ['/x']);
});

check('normaliseOutcome rejects unknown status', () => {
  const c = defineCheck({ id: 'a', run() {} });
  assert.throws(() => normaliseOutcome(c, 'done'), TypeError);
});

check('harnessErrorResult tags failure_source=evaluator', () => {
  const c = defineCheck({ id: 'a', run() {} });
  const r = harnessErrorResult(c, { error: new Error('boom') });
  assert.equal(r.status, STATUS.ERROR);
  assert.equal(r.failure_source, 'evaluator');
  assert.ok(r.evidence?.stack);
});

check('skippedResult is a harness status', () => {
  const c = defineCheck({ id: 'a', run() {} });
  const r = skippedResult(c, 'no artifact');
  assert.equal(r.status, STATUS.SKIPPED);
  assert.equal(r.failure_source, 'evaluator');
  assert.equal(r.reason, 'no artifact');
});

check('attachExecutorEvidence infers project failure source', () => {
  const r = attachExecutorEvidence(
    { check_id: 'a', status: 'fail', reason: 'x' },
    { exit_code: 1, duration_ms: 12 },
  );
  assert.equal(r.failure_source, 'project');
  assert.equal(r.exit_code, 1);
});

// --- runner.mjs -----------------------------------------------------------

await asyncCheck('runCheck succeeds for an inline passing check', async () => {
  const ctx = createExecutionContext({ workspace: mkdtempDir() });
  const check = defineCheck({ id: 'inline-pass', run: () => 'pass' });
  const r = await runCheck(check, ctx);
  assert.equal(r.status, 'pass');
  assert.equal(r.failure_source, null);
});

await asyncCheck('runCheck records project failure source', async () => {
  const ctx = createExecutionContext({ workspace: mkdtempDir() });
  const check = defineCheck({ id: 'inline-fail', run: () => ({ status: 'fail', reason: 'broken' }) });
  const r = await runCheck(check, ctx);
  assert.equal(r.status, 'fail');
  assert.equal(r.failure_source, 'project');
  assert.equal(r.reason, 'broken');
});

await asyncCheck('runCheck converts thrown assertions into harness errors', async () => {
  const ctx = createExecutionContext({ workspace: mkdtempDir() });
  const check = defineCheck({
    id: 'inline-throws',
    run: () => { throw new Error('boom'); },
  });
  const r = await runCheck(check, ctx);
  assert.equal(r.status, 'error');
  assert.equal(r.failure_source, 'evaluator');
  assert.match(r.reason, /threw/);
});

await asyncCheck('runCheck marks a timed-out command as error', async () => {
  const logs = mkdtempDir();
  const ctx = createExecutionContext({ workspace: logs });
  const check = defineCheck({
    id: 'timeout-cmd',
    timeout_ms: 80,
    command: { executable: 'node', args: ['-e', 'setTimeout(()=>{}, 5000)'] },
    run: (c, exec) => exec.timed_out ? { status: 'error', reason: 'timed out' } : 'pass',
  });
  const r = await runCheck(check, ctx, { logsDir: logs });
  assert.equal(r.status, 'error');
  assert.equal(r.timed_out, true);
  assert.ok(r.stdout_path);
});

await asyncCheck('runCheck skips when a required artifact is missing', async () => {
  const ctx = createExecutionContext({ workspace: mkdtempDir() });
  const check = defineCheck({
    id: 'needs-artifact',
    requires_artifacts: ['hidden-sample'],
    run: () => 'pass',
  });
  const r = await runCheck(check, ctx);
  assert.equal(r.status, 'skipped');
  assert.equal(r.failure_source, 'evaluator');
});

await asyncCheck('runCheck skips when a dependency failed', async () => {
  const ctx = createExecutionContext({ workspace: mkdtempDir() });
  const check = defineCheck({
    id: 'dependent',
    depends_on: ['prior'],
    run: () => 'pass',
  });
  const deps = new Map([['prior', STATUS.FAIL]]);
  const r = await runCheck(check, ctx, { dependencyStatus: deps });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /dependency "prior"/);
});

await asyncCheck('runCheck captures command evidence (stdout/stderr paths)', async () => {
  const logs = mkdtempDir();
  const ctx = createExecutionContext({ workspace: logs });
  const check = defineCheck({
    id: 'cmd-pass',
    command: { executable: 'node', args: ['-e', 'process.exit(0)'] },
    run: (c, exec) => exec.exit_code === 0 ? 'pass' : { status: 'fail', reason: `exit ${exec.exit_code}` },
  });
  const r = await runCheck(check, ctx, { logsDir: logs });
  assert.equal(r.status, 'pass');
  assert.ok(r.stdout_path);
  assert.ok(r.stderr_path);
  assert.equal(r.exit_code, 0);
});

// --- scoring.mjs ----------------------------------------------------------

check('normaliseRubric accepts v1 and legacy shapes', () => {
  const v1 = normaliseRubric(baseRubric());
  assert.equal(v1.version, 1);
  assert.ok(v1.hardGates.has('build'));
  const legacy = normaliseRubric({
    weights: { a: 50, b: 50 },
    gates: { p0_min_score: 80, critical_failure_cap: 49 },
    levels: { p0: 'required', p1: 'differentiator', p2: 'production' },
  });
  assert.equal(legacy.legacy, true);
  assert.deepEqual(Object.keys(legacy.categories).sort(), ['a', 'b']);
});

check('normaliseRubric rejects unknown shapes', () => {
  assert.throws(() => normaliseRubric({ random: 1 }), TypeError);
});

check('scoreEvaluation: all-pass yields total 100 and accepted', () => {
  const results = [
    passResult('build', { hard_gate: true, level: 'p0' }),
    passResult('unit-tests', { level: 'p0' }),
    passResult('overview-renders', { level: 'p0' }),
    passResult('events-valid'),
  ];
  const card = scoreEvaluation(results, baseRubric());
  assert.equal(card.status, 'success');
  assert.equal(card.total, 100);
  assert.equal(card.completeness.skipped.length, 0);
  assert.equal(card.completeness.unrun_rubric_checks.length, 0);
});

check('scoreEvaluation: hard gate failure caps total at 0 and rejects', () => {
  const results = [
    failResult('build', { hard_gate: true, level: 'p0' }),
    passResult('unit-tests', { level: 'p0' }),
    passResult('overview-renders', { level: 'p0' }),
    passResult('events-valid'),
  ];
  const card = scoreEvaluation(results, baseRubric());
  assert.equal(card.status, 'error');
  assert.equal(card.total, 0);
  assert.deepEqual(card.hard_gates.failing, ['build']);
  assert.ok(card.next_actions.some(a => a.includes('hard gate')));
});

check('scoreEvaluation: P0 failure applies p0_failure_max_score cap', () => {
  const rubric = baseRubric();
  rubric.hard_gates = [];
  const results = [
    passResult('build', { level: 'p0' }),
    failResult('unit-tests', { level: 'p0' }),
    passResult('overview-renders', { level: 'p0' }),
    passResult('events-valid'),
  ];
  const card = scoreEvaluation(results, rubric);
  assert.equal(card.status, 'warning');
  assert.equal(card.total, 49);
  assert.deepEqual(card.p0.failing, ['unit-tests']);
});

check('scoreEvaluation: un-run rubric check triggers incomplete cap', () => {
  const results = [
    passResult('build', { hard_gate: true, level: 'p0' }),
    passResult('unit-tests', { level: 'p0' }),
    passResult('overview-renders', { level: 'p0' }),
    // events-valid never ran
  ];
  const card = scoreEvaluation(results, baseRubric());
  assert.equal(card.status, 'error');
  assert.equal(card.total, 0);
  assert.equal(card.completeness.unrun_rubric_checks.length, 1);
  assert.equal(card.completeness.unrun_rubric_checks[0].check_id, 'events-valid');
});

check('scoreEvaluation: skipped checks count as incomplete', () => {
  const results = [
    passResult('build', { hard_gate: true, level: 'p0' }),
    passResult('unit-tests', { level: 'p0' }),
    passResult('overview-renders', { level: 'p0' }),
    skippedFakeResult('events-valid'),
  ];
  const card = scoreEvaluation(results, baseRubric());
  assert.equal(card.status, 'error');
  assert.ok(card.completeness.skipped.includes('events-valid'));
});

check('scoreEvaluation: harness errors are invalid-run', () => {
  const results = [
    passResult('build', { hard_gate: true, level: 'p0' }),
    errorFakeResult('unit-tests'),
    passResult('overview-renders', { level: 'p0' }),
    passResult('events-valid'),
  ];
  const card = scoreEvaluation(results, baseRubric());
  assert.equal(card.status, 'error');
  assert.ok(card.completeness.harness_errors.includes('unit-tests'));
});

check('scoreEvaluation: warnings count half weight', () => {
  const rubric = baseRubric();
  rubric.hard_gates = [];
  const results = [
    passResult('build', { level: 'p0' }),
    warningResult('unit-tests', { level: 'p0' }),
    passResult('overview-renders', { level: 'p0' }),
    passResult('events-valid'),
  ];
  const card = scoreEvaluation(results, rubric);
  // engineering: 1 pass + 1 warning(0.5) over 2 declared => 0.75 * 60 = 45
  assert.equal(card.categories.engineering.score, 45);
  // business: 2/2 => 40
  assert.equal(card.categories.business.score, 40);
  assert.equal(card.total, 85);
});

check('scoreEvaluation: duplicate check ids surface in completeness', () => {
  const results = [
    passResult('build', { hard_gate: true, level: 'p0' }),
    passResult('build', { hard_gate: true, level: 'p0' }),
    passResult('unit-tests', { level: 'p0' }),
    passResult('overview-renders', { level: 'p0' }),
    passResult('events-valid'),
  ];
  const card = scoreEvaluation(results, baseRubric());
  assert.deepEqual(card.completeness.duplicate_check_ids, ['build']);
  assert.ok(card.next_actions.some(a => a.includes('De-duplicate')));
});

// --- evidence.mjs ---------------------------------------------------------

check('createEvidenceBundle redacts large fields and keeps paths', () => {
  const results = [
    {
      check_id: 'build', status: 'pass', stdout_path: '/tmp/o', stderr_path: '/tmp/e',
      artifacts: ['/tmp/a'], duration_ms: 3, command: { executable: 'node', args: [] },
      exit_code: 0,
    },
  ];
  const card = scoreEvaluation(results, {
    version: 1, total: 100, hard_gates: ['build'],
    categories: { engineering: { weight: 100, checks: ['build'] } }, caps: {},
  });
  const bundle = createEvidenceBundle({
    runId: 'r', caseId: 'c', results, scorecard: card,
  });
  assert.equal(bundle.schema_version, 1);
  assert.equal(bundle.results[0].stdout_path, '/tmp/o');
  assert.equal(bundle.results[0].command.executable, 'node');
  assert.ok(bundle.rubric_fingerprint.startsWith('v1:'));
});

check('createEvidenceBundle rejects results with invalid status', () => {
  assert.throws(() => createEvidenceBundle({
    results: [{ check_id: 'x', status: 'done' }],
    scorecard: { status: 'success', summary: '', total: 0, raw_total: 0, effective_cap: 0,
      applied_caps: [], hard_gates: { declared: [], failing: [] },
      p0: { min_score: 0, failing: [] }, completeness: { executed: [], skipped: [],
      harness_errors: [], unrun_rubric_checks: [], duplicate_check_ids: [] },
      categories: {}, next_actions: [] },
  }), TypeError);
});

check('partitionByFailureSource separates project and evaluator faults', () => {
  const buckets = partitionByFailureSource([
    { check_id: 'a', status: 'pass' },
    { check_id: 'b', status: 'fail', failure_source: 'project' },
    { check_id: 'c', status: 'error', failure_source: 'evaluator' },
    { check_id: 'd', status: 'skipped', failure_source: 'evaluator' },
  ]);
  assert.equal(buckets.project.length, 1);
  assert.equal(buckets.evaluator.length, 2);
  assert.equal(buckets.none.length, 1);
});

check('summariseBundle renders key counts', () => {
  const bundle = {
    total: 42, status: 'warning',
    results: [
      { status: 'pass' }, { status: 'fail' }, { status: 'warning' },
      { status: 'skipped' }, { status: 'error' },
    ],
    completeness: { duplicate_check_ids: ['x'] },
  };
  const s = summariseBundle(bundle);
  assert.match(s, /total=42/);
  assert.match(s, /pass=1/);
  assert.match(s, /duplicate_ids=1/);
});

// --- lifecycle.mjs --------------------------------------------------------

await asyncCheck('runEvaluation runs all checks, scores, and bundles evidence', async () => {
  const logs = mkdtempDir();
  const evaluator = {
    caseId: 'demo',
    rubric: baseRubric(),
    checks: [
      declareCheck({ id: 'build', level: 'p0', hard_gate: true, run: () => 'pass' }),
      declareCheck({ id: 'unit-tests', level: 'p0', run: () => 'pass' }),
      declareCheck({ id: 'overview-renders', level: 'p0', run: () => 'pass' }),
      declareCheck({ id: 'events-valid', run: () => 'pass' }),
    ],
  };
  const out = await runEvaluation(evaluator, { logsDir: logs, workspace: logs });
  assert.equal(out.status, 'success');
  assert.equal(out.bundle.total, 100);
  assert.equal(out.bundle.results.length, 4);
  assert.equal(out.scorecard.completeness.unrun_rubric_checks.length, 0);
});

await asyncCheck('runEvaluation aborts a duplicate-id evaluator', async () => {
  const logs = mkdtempDir();
  const evaluator = {
    caseId: 'dup',
    rubric: baseRubric(),
    checks: [
      declareCheck({ id: 'build', run: () => 'pass' }),
      declareCheck({ id: 'build', run: () => 'pass' }),
    ],
  };
  await assert.rejects(() => runEvaluation(evaluator, { logsDir: logs }), /duplicate check id/);
});

await asyncCheck('runEvaluation guards against missing rubric coverage', async () => {
  const logs = mkdtempDir();
  const evaluator = {
    caseId: 'gap',
    rubric: baseRubric(),
    checks: [declareCheck({ id: 'build', run: () => 'pass' })],
  };
  await assert.rejects(() => runEvaluation(evaluator, { logsDir: logs }), /rubric checks missing/);
});

await asyncCheck('runEvaluation continues after a harness crash', async () => {
  const logs = mkdtempDir();
  const evaluator = {
    caseId: 'resilient',
    rubric: baseRubric(),
    checks: [
      declareCheck({ id: 'build', level: 'p0', hard_gate: true, run: () => 'pass' }),
      declareCheck({
        id: 'unit-tests', level: 'p0',
        run: () => { throw new Error('boom'); },
      }),
      declareCheck({ id: 'overview-renders', level: 'p0', run: () => 'pass' }),
      declareCheck({ id: 'events-valid', run: () => 'pass' }),
    ],
  };
  const out = await runEvaluation(evaluator, { logsDir: logs, workspace: logs });
  assert.equal(out.status, 'error');
  assert.ok(out.scorecard.completeness.harness_errors.includes('unit-tests'));
  // Subsequent checks still ran
  assert.ok(out.bundle.results.some(r => r.check_id === 'events-valid' && r.status === 'pass'));
});

await asyncCheck('runEvaluation stops executing when run budget is exhausted', async () => {
  const logs = mkdtempDir();
  const evaluator = {
    caseId: 'budget',
    rubric: baseRubric(),
    checks: [
      declareCheck({ id: 'build', level: 'p0', hard_gate: true, run: async () => { await delay(20); return 'pass'; } }),
      declareCheck({ id: 'unit-tests', level: 'p0', run: async () => { await delay(20); return 'pass'; } }),
      declareCheck({ id: 'overview-renders', level: 'p0', run: async () => { await delay(20); return 'pass'; } }),
      declareCheck({ id: 'events-valid', run: async () => { await delay(20); return 'pass'; } }),
    ],
  };
  const out = await runEvaluation(evaluator, { logsDir: logs, workspace: logs, runTimeoutMs: 35 });
  assert.equal(out.status, 'error');
  assert.ok(out.scorecard.completeness.skipped.length > 0);
});

await asyncCheck('EVALUATOR_CORE_VERSION is exported', () => {
  assert.ok(EVALUATOR_CORE_VERSION.startsWith('v'));
});

// --- helpers --------------------------------------------------------------

function mkdtempDir() {
  return mkdtempSync(join(tmpdir(), 'vab-t04-'));
}

function passResult(id, extra = {}) {
  return { check_id: id, status: 'pass', duration_ms: 1, artifacts: [], ...extra };
}
function failResult(id, extra = {}) {
  return { check_id: id, status: 'fail', reason: 'broken', duration_ms: 1, artifacts: [], failure_source: 'project', ...extra };
}
function warningResult(id, extra = {}) {
  return { check_id: id, status: 'warning', reason: 'soft', duration_ms: 1, artifacts: [], ...extra };
}
function skippedFakeResult(id) {
  return { check_id: id, status: 'skipped', reason: 'dep', duration_ms: 0, artifacts: [], failure_source: 'evaluator' };
}
function errorFakeResult(id) {
  return { check_id: id, status: 'error', reason: 'crash', duration_ms: 0, artifacts: [], failure_source: 'evaluator' };
}

// --- summary --------------------------------------------------------------

const failed = results.filter(r => !r.ok);
process.stdout.write(`${JSON.stringify({
  status: failed.length ? 'error' : 'success',
  summary: `${results.length - failed.length}/${results.length} evaluator-core checks passed.`,
  next_actions: failed.length ? ['Fix failing evaluator-core checks.'] : [],
  artifacts: ['tests/evaluators/core/run.mjs'],
  ...(failed.length ? { failures: failed } : {}),
}, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
