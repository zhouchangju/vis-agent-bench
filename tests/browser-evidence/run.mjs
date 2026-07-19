import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCapture,
  validateCaptureSpec,
  validateEvidencePackage,
  redactForBlindReview,
  BLIND_REVIEW_HIDDEN_FIELDS,
  ERROR_CODES,
  structuredError,
  isStructuredError,
} from '../../src/browser-evidence/index.mjs';
import {
  validateHumanReviewPackage,
  buildHumanReviewPackage,
  loadHumanReviewPackage,
  redactPackageForBlindReview,
  describeBlindState,
  looksLikeModelIdentifier,
  readRunEvidence,
  summarizeRunEvidence,
} from '../../src/review/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function expectInvalid(result, code) {
  assert.equal(result.valid, false, `Expected invalid; got valid for ${JSON.stringify(result).slice(0, 200)}`);
  const codes = result.errors.map(error => error.code);
  assert.ok(codes.includes(code), `Expected ${code}; got ${codes.join(', ')}`);
}

const checks = [
  ['structured errors reject unknown codes', () => {
    assert.throws(() => structuredError('NOPE', 'x'), /Unknown browser-evidence error code/);
    const err = structuredError('SELECTOR_MISSING', 'bad selector', { selector: '#x' });
    assert.equal(isStructuredError(err), true);
    assert.equal(isStructuredError({ code: 'NOPE', message: 'x' }), false);
  }],

  ['capture spec validates the happy path', () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    const result = validateCaptureSpec(spec, { root: fixturesDir });
    assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
    assert.equal(result.spec.capture_id, 'dashboard-smoke');
    assert.equal(result.spec.viewport.width, 1280);
  }],

  ['capture spec rejects unknown action kinds', () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    spec.actions = [{ kind: 'magic', selector: '#x' }];
    expectInvalid(validateCaptureSpec(spec, { root: fixturesDir }), 'ENUM');
  }],

  ['capture spec rejects absolute fixture_dir', () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    spec.fixture_dir = '/abs/dashboard';
    expectInvalid(validateCaptureSpec(spec, { root: fixturesDir }), 'RELATIVE_PATH');
  }],

  ['capture spec rejects unknown wait kind', () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    spec.wait = { kind: 'forever' };
    expectInvalid(validateCaptureSpec(spec, { root: fixturesDir }), 'ENUM');
  }],

  ['capture spec rejects selector wait without selector', () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    spec.wait = { kind: 'selector' };
    expectInvalid(validateCaptureSpec(spec, { root: fixturesDir }), 'REQUIRED');
  }],

  ['capture spec rejects external urls in default config', () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    spec.url = 'about:blank';
    delete spec.fixture_dir;
    delete spec.fixture_index;
    // url invalid scheme and no fixture fallback
    expectInvalid(validateCaptureSpec(spec, { root: fixturesDir }), 'URL');
  }],

  ['capture spec rejects unknown top-level field', () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    spec.banana = 1;
    expectInvalid(validateCaptureSpec(spec, { root: fixturesDir }), 'UNEXPECTED_FIELD');
  }],

  ['static fixture driver captures dashboard evidence', async () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    const tmp = mkdtempSync(join(tmpdir(), 'vab-t06-'));
    try {
      const result = await runCapture(spec, { root: fixturesDir, outDir: tmp });
      assert.equal(result.status, 'success', JSON.stringify(result.errors, null, 2));
      assert.equal(result.evidence.case_id, 'macro-map-3d-greenfield');
      assert.equal(result.evidence.screenshots.length, 2, 'expected initial + after-refresh');
      // after-load auto snapshot plus the explicit `initial-dom` snapshot.
      assert.equal(result.evidence.dom_snapshots.length, 2);
      assert.equal(result.evidence.failures.length, 0);
      const json = readFileSync(join(tmp, 'browser-evidence.json'), 'utf8');
      const parsed = JSON.parse(json);
      assert.equal(parsed.capture_id, 'dashboard-smoke');
      assert.equal(parsed.canvas_webgl_proven, false, 'static driver must not claim Canvas/WebGL proof');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }],

  ['static fixture driver reports SELECTOR_MISSING for unknown action selector', async () => {
    const spec = readJson(join(fixturesDir, 'broken.capture.json'));
    const result = await runCapture(spec, { root: fixturesDir });
    assert.notEqual(result.status, 'success');
    const codes = result.evidence.failures.map(f => f.code);
    assert.ok(codes.includes('SELECTOR_MISSING'), `expected SELECTOR_MISSING in ${codes.join(', ')}`);
    assert.equal(result.evidence.failures.length > 0, true);
  }],

  ['static fixture driver reports PAGE_ERROR and NETWORK_FAILURE from broken fixture', async () => {
    const spec = readJson(join(fixturesDir, 'broken.capture.json'));
    // Drop the action that targets a missing selector so we observe error capture.
    spec.actions = [{ kind: 'screenshot', 'label': 'broken' }];
    const result = await runCapture(spec, { root: fixturesDir });
    const codes = result.evidence.failures.map(f => f.code);
    assert.ok(codes.includes('PAGE_ERROR'), `expected PAGE_ERROR in ${codes.join(', ')}`);
    assert.ok(codes.includes('NETWORK_FAILURE'), `expected NETWORK_FAILURE in ${codes.join(', ')}`);
    assert.equal(result.evidence.page_errors.length, 1);
    assert.equal(result.evidence.network_events.length, 1);
    assert.equal(result.evidence.network_events[0].failed, true);
  }],

  ['static fixture driver surfaces SELECTOR_MISSING on load wait', async () => {
    const spec = readJson(join(fixturesDir, 'selector-missing.capture.json'));
    const result = await runCapture(spec, { root: fixturesDir });
    assert.notEqual(result.status, 'success');
    assert.ok(result.evidence.failures.some(f => f.code === 'SELECTOR_MISSING'));
  }],

  ['static fixture driver fails when fixture_dir does not exist', async () => {
    const spec = readJson(join(fixturesDir, 'dashboard.capture.json'));
    spec.fixture_dir = 'missing-dir';
    const result = await runCapture(spec, { root: fixturesDir });
    assert.equal(result.status, 'error');
    assert.ok(result.evidence.failures.some(f => f.code === 'LOAD_FAILED'));
  }],

  ['evidence package validator accepts a healthy package', () => {
    const pkg = {
      schema_version: 1,
      capture_id: 'x', run_id: 'r', case_id: 'c', driver: 'static-fixture',
      captured_at: new Date().toISOString(), duration_ms: 1,
      page_url: 'file:///x', viewport: { width: 1, height: 1 }, wait: { kind: 'none' },
      screenshots: [], dom_snapshots: [], console_errors: [], page_errors: [],
      network_events: [], action_log: [], failures: [], status: 'success',
    };
    assert.equal(validateEvidencePackage(pkg).valid, true);
  }],

  ['evidence package validator flags error status without load failure', () => {
    const pkg = {
      schema_version: 1,
      capture_id: 'x', run_id: 'r', case_id: 'c', driver: 'static-fixture',
      captured_at: new Date().toISOString(), duration_ms: 1,
      page_url: 'file:///x', viewport: { width: 1, height: 1 }, wait: { kind: 'none' },
      screenshots: [], dom_snapshots: [], console_errors: [], page_errors: [],
      network_events: [], action_log: [], failures: [{ code: 'SELECTOR_MISSING', message: 'x' }],
      status: 'error',
    };
    expectInvalid(validateEvidencePackage(pkg), 'STATUS_FAILURE_MISMATCH');
  }],

  ['evidence package validator flags unknown failure code', () => {
    const pkg = {
      schema_version: 1,
      capture_id: 'x', run_id: 'r', case_id: 'c', driver: 'static-fixture',
      captured_at: new Date().toISOString(), duration_ms: 1,
      page_url: 'file:///x', viewport: { width: 1, height: 1 }, wait: { kind: 'none' },
      screenshots: [], dom_snapshots: [], console_errors: [], page_errors: [],
      network_events: [], action_log: [], failures: [{ code: 'NOPE', message: 'x' }],
      status: 'warning',
    };
    expectInvalid(validateEvidencePackage(pkg), 'ENUM');
  }],

  ['blind review redaction hides driver and user_agent', () => {
    const pkg = {
      schema_version: 1, capture_id: 'x', run_id: 'r', case_id: 'c',
      driver: 'playwright:chromium-1234', user_agent: 'vis-agent-bench/codex',
      captured_at: new Date().toISOString(), duration_ms: 1,
      page_url: 'file:///x', viewport: { width: 1, height: 1 }, wait: { kind: 'none' },
      screenshots: [], dom_snapshots: [], console_errors: [], page_errors: [],
      network_events: [], action_log: [], failures: [],
      status: 'success',
    };
    const redacted = redactForBlindReview(pkg);
    assert.equal(redacted.driver, '[blind:review]');
    assert.equal(redacted.user_agent, '[blind:review]');
    assert.deepEqual(BLIND_REVIEW_HIDDEN_FIELDS.sort(), ['driver', 'user_agent'].sort());
  }],

  ['human review package builder fills defaults for a draft', () => {
    const pkg = buildHumanReviewPackage({
      run_id: 'r1', reviewer: 'Leo',
      reviews: [{
        case_id: 'macro-map-3d-greenfield',
        decision: 'accepted',
        scores: { business: 5, visual: 4, interaction: 4, usability: 4 },
        human_time: { clarification_minutes: 5 },
        convergence: { first_poc_fitness_percent: 80 },
        observations: { strengths: 'x' },
      }],
    });
    assert.equal(pkg.schema_version, 2);
    assert.equal(pkg.blind_review, false);
    const review = pkg.reviews[0];
    assert.equal(review.complete, true);
    assert.equal(review.human_time.context_prep_minutes, 0);
    assert.equal(review.convergence.must_have_misses, 0);
    assert.equal(review.observations.problems, '');
  }],

  ['human review validator accepts the canonical example', () => {
    const pkg = buildHumanReviewPackage({
      run_id: 'r1', reviewer: 'Leo', reviewed_at: '2026-07-19T08:00:00.000Z',
      reviews: [{
        case_id: 'macro-map-3d-greenfield',
        decision: 'accepted',
        scores: { business: 5, visual: 5, interaction: 4, usability: 4 },
        human_time: {
          clarification_minutes: 5, context_prep_minutes: 10, poc_review_minutes: 20,
          micro_adjustment_minutes: 30, fix_minutes: 0, final_review_minutes: 10,
        },
        convergence: {
          clarification_rounds: 2, iterations_to_acceptance: 3, micro_adjustment_items: 4,
          must_have_misses: 0, requirement_regressions: 0, first_poc_fitness_percent: 70,
        },
        observations: { strengths: 's', problems: 'p', required_fixes: 'r', management_judgment: 'm' },
      }],
    });
    const result = validateHumanReviewPackage(pkg);
    assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  }],

  ['human review validator rejects out-of-range score', () => {
    const pkg = buildHumanReviewPackage({
      run_id: 'r1', reviewer: 'Leo',
      reviews: [{
        case_id: 'c', decision: 'accepted',
        scores: { business: 9, visual: 4, interaction: 4, usability: 4 },
        human_time: {}, convergence: {}, observations: {},
      }],
    });
    // Force a known invalid value post-build to check the validator path.
    pkg.reviews[0].scores.business = 9;
    expectInvalid(validateHumanReviewPackage(pkg), 'SCORE_RANGE');
  }],

  ['human review validator rejects complete=true with decision null', () => {
    const pkg = buildHumanReviewPackage({
      run_id: 'r1', reviewer: 'Leo',
      reviews: [{
        case_id: 'c', complete: true, decision: null,
        scores: { business: 5, visual: 5, interaction: 5, usability: 5 },
        human_time: {}, convergence: {}, observations: {},
      }],
    });
    expectInvalid(validateHumanReviewPackage(pkg), 'INCOMPLETE_REVIEW');
  }],

  ['human review validator rejects missing decision on a complete review', () => {
    const pkg = buildHumanReviewPackage({
      run_id: 'r1', reviewer: 'Leo',
      reviews: [{
        case_id: 'c', complete: true,
        scores: { business: 3, visual: 3, interaction: 3, usability: 3 },
        human_time: {}, convergence: {}, observations: {},
      }],
    });
    delete pkg.reviews[0].decision;
    expectInvalid(validateHumanReviewPackage(pkg), 'REQUIRED');
  }],

  ['blind review classification hides model-identifying run_id', () => {
    const pkg = { run_id: '2026-07-19T08-00-00_codex_xxxx', reviewer: 'Leo', reviews: [] };
    assert.equal(looksLikeModelIdentifier(pkg.run_id), true);
    const redacted = redactPackageForBlindReview(pkg);
    assert.equal(redacted.run_id, '[blind:run_id]');
    assert.equal(redacted.reviewer, '[blind:reviewer]');
    assert.equal(redacted.blind_review, true);
    assert.equal(describeBlindState(redacted), 'blind-on');
  }],

  ['run evidence reader summarizes the sample run', () => {
    const runDir = join(fixturesDir, 'sample-run');
    const evidence = readRunEvidence(runDir);
    assert.equal(evidence.available, true);
    assert.equal(evidence.run_spec.case_id, 'macro-map-3d-greenfield');
    assert.equal(evidence.workspace_diff_path != null, true);
    const summary = summarizeRunEvidence(evidence);
    assert.equal(summary.case_id, 'macro-map-3d-greenfield');
    assert.equal(summary.workspace_diff_present, true);
  }],

  ['run evidence reader handles a missing run directory', () => {
    const evidence = readRunEvidence(join(fixturesDir, 'no-such-run'));
    assert.equal(evidence.available, false);
    const summary = summarizeRunEvidence(evidence);
    assert.equal(summary.available, false);
  }],

  ['loadHumanReviewPackage returns MISSING_FILE for absent paths', () => {
    const result = loadHumanReviewPackage(join(fixturesDir, 'absent.json'));
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].code, 'MISSING_FILE');
  }],
];

const failures = [];
for (const [name, check] of checks) {
  try {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.stack });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  }
}

const summary = {
  status: failures.length ? 'error' : 'success',
  summary: `${checks.length - failures.length}/${checks.length} browser-evidence checks passed.`,
  next_actions: failures.length ? ['Fix failing browser-evidence checks.'] : [],
  artifacts: ['tests/browser-evidence/run.mjs'],
  ...(failures.length ? { failures } : {}),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
