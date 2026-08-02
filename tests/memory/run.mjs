import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  buildMemoryPairedReport,
  validateMemoryExperimentSpec,
  validateMemoryFeedback,
  validateMemoryIntervention,
  validateMemoryPairedReport,
} from '../../src/memory/index.mjs';
import {
  evaluateMemoryEffectivenessSmoke,
} from '../../src/evaluators/cases/memory-effectiveness-smoke/index.mjs';
import {
  PRIMARY_CASES,
  getCaseRuntime,
} from '../../src/control-plane/case-registry.mjs';
import { runGoldenPipeline } from '../../src/control-plane/pipeline.mjs';
import { buildRunSpec } from '../../src/control-plane/run-spec.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const offFixturePath = join(import.meta.dirname, 'fixtures/off-run.json');
const approvedFixturePath = join(import.meta.dirname, 'fixtures/approved-run.json');
const off = JSON.parse(readFileSync(offFixturePath, 'utf8'));
const approved = JSON.parse(readFileSync(approvedFixturePath, 'utf8'));
const checks = [];

function check(name, fn) {
  checks.push([name, fn]);
}

function invalid(fn, pattern) {
  assert.throws(fn, pattern);
}

check('shared experiment and intervention contracts accept the paired fixtures', () => {
  assert.equal(validateMemoryExperimentSpec(off.experimentSpec).valid, true);
  assert.equal(validateMemoryIntervention(off.intervention).valid, true);
  assert.equal(validateMemoryIntervention(approved.intervention).valid, true);
  for (const feedback of approved.feedback) {
    assert.equal(validateMemoryFeedback(feedback, { intervention: approved.intervention }).valid, true);
  }
  const impossibleDate = structuredClone(off.experimentSpec);
  impossibleDate.createdAt = '2026-02-30T00:00:00Z';
  assert.equal(validateMemoryExperimentSpec(impossibleDate).valid, false);
  const offsetDate = structuredClone(off.experimentSpec);
  offsetDate.createdAt = '2026-07-26T08:00:00+08:00';
  assert.equal(validateMemoryExperimentSpec(offsetDate).valid, true);
  for (const invalidTimestamp of [
    '2026-07-26t00:00:00Z',
    '2026-07-26T00:00:00z',
    '0000-07-26T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-07-26T24:00:00Z',
    '2026-07-26T23:59:60Z',
  ]) {
    const invalidSpec = structuredClone(off.experimentSpec);
    invalidSpec.createdAt = invalidTimestamp;
    assert.equal(validateMemoryExperimentSpec(invalidSpec).valid, false, invalidTimestamp);
  }
});

check('off rejects a Context Pack or selected-memory contamination', () => {
  const contaminated = structuredClone(off.intervention);
  contaminated.contextPackHash = 'a'.repeat(64);
  contaminated.selectedMemoryIds = ['leaked-memory'];
  const result = validateMemoryIntervention(contaminated);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'OFF_CONTAMINATION'));
});

check('approved_only requires a hash even for an empty Context Pack', () => {
  const emptyPack = structuredClone(approved.intervention);
  emptyPack.selectedMemoryIds = [];
  assert.equal(validateMemoryIntervention(emptyPack).valid, true);
  emptyPack.contextPackHash = null;
  assert.equal(validateMemoryIntervention(emptyPack).valid, false);
});

check('feedback requires evidence and selected-memory membership', () => {
  const noEvidence = structuredClone(approved.feedback[0]);
  noEvidence.evidenceRefs = [];
  assert.ok(validateMemoryFeedback(noEvidence, { intervention: approved.intervention }).errors.some(error => error.code === 'EVIDENCE_REQUIRED'));
  const unselected = structuredClone(approved.feedback[0]);
  unselected.memoryId = 'not-selected';
  assert.ok(validateMemoryFeedback(unselected, { intervention: approved.intervention }).errors.some(error => error.code === 'UNSELECTED_MEMORY'));
  unselected.memoryId = null;
  assert.equal(validateMemoryFeedback(unselected, { intervention: approved.intervention }).valid, true);
});

check('paired comparison reports utilization, feedback and unavailable cost without estimating', () => {
  const report = buildMemoryPairedReport(off, approved, { generatedAt: '2026-07-26T01:00:00.000Z' });
  assert.equal(validateMemoryPairedReport(report).valid, true);
  assert.equal(report.feedbackCounts.helpful, 1);
  assert.equal(report.feedbackCounts.harmful, 1);
  assert.deepEqual(report.utilization, {
    availability: 'reported',
    selectedCount: 2,
    observedCount: 2,
    rate: 1,
  });
  assert.deepEqual(report.deltas.quality, {
    availability: 'reported',
    value: 100,
    unit: 'score',
    direction: 'approved_only_minus_off',
  });
  assert.equal(report.deltas.time.value, -40);
  assert.deepEqual(report.deltas.cost, {
    availability: 'unavailable',
    value: null,
    unit: 'USD',
    reason: 'one_or_both_arms_missing',
  });
  assert.equal(report.arms.off.contextPackHash, null);
  assert.equal(report.arms.approved_only.retrievalRunId, 'memory_retrieval_approved_001');
  assert.equal(report.arms.off.sessionId, 'session_off_001');
  assert.equal(report.arms.approved_only.workspaceId, 'workspace_approved_001');
});

check('pair input order is irrelevant and zero-match feedback stays explicit', () => {
  const generatedAt = '2026-07-26T01:00:00.000Z';
  assert.deepEqual(
    buildMemoryPairedReport(off, approved, { generatedAt }),
    buildMemoryPairedReport(approved, off, { generatedAt }),
  );
  const zeroMatch = structuredClone(approved);
  zeroMatch.intervention.selectedMemoryIds = [];
  zeroMatch.feedback = [{
    ...zeroMatch.feedback[0],
    feedbackId: 'memory_feedback_zero_match',
    memoryId: null,
    outcome: 'neutral',
    note: 'Retrieval completed with no matching approved memory.',
  }];
  const report = buildMemoryPairedReport(off, zeroMatch, { generatedAt });
  assert.equal(report.feedbackCounts.neutral, 1);
  assert.deepEqual(report.utilization, {
    availability: 'unavailable',
    selectedCount: 0,
    observedCount: 0,
    rate: null,
    reason: 'no_selected_memories',
  });
});

check('a failed arm keeps feedback but makes every causal delta unavailable', () => {
  const failedApproved = structuredClone(approved);
  failedApproved.result.status = 'failed';
  const report = buildMemoryPairedReport(off, failedApproved, { generatedAt: '2026-07-26T01:00:00.000Z' });
  assert.equal(report.comparisonStatus, 'ineligible');
  assert.equal(report.feedbackCounts.harmful, 1);
  for (const metric of Object.values(report.deltas)) {
    assert.equal(metric.availability, 'unavailable');
    assert.equal(metric.value, null);
    assert.equal(metric.reason, 'one_or_both_arms_ineligible');
  }
  assert.equal(validateMemoryPairedReport(report).valid, true);
});

check('paired report validator rejects internally inconsistent utilization', () => {
  const report = buildMemoryPairedReport(off, approved, { generatedAt: '2026-07-26T01:00:00.000Z' });
  report.utilization = {
    availability: 'reported',
    selectedCount: 1,
    observedCount: 99,
    rate: 0.5,
  };
  const validation = validateMemoryPairedReport(report);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.code === 'UTILIZATION_MISMATCH'));
});

check('paired comparison rejects same arm, control mismatch, missing evidence, and evidence contamination', () => {
  const sameArm = structuredClone(off);
  invalid(() => buildMemoryPairedReport(off, sameArm), /different arms/);

  const wrongModel = structuredClone(approved);
  wrongModel.experimentSpec.controls.model = 'different-model';
  invalid(() => buildMemoryPairedReport(off, wrongModel), /control variables differ/);

  const reusedSession = structuredClone(approved);
  reusedSession.execution.sessionId = off.execution.sessionId;
  invalid(() => buildMemoryPairedReport(off, reusedSession), /sessionId values must be distinct/);

  const reusedWorkspace = structuredClone(approved);
  reusedWorkspace.execution.workspaceId = off.execution.workspaceId;
  invalid(() => buildMemoryPairedReport(off, reusedWorkspace), /workspaceId values must be distinct/);

  const missingExecution = structuredClone(approved);
  delete missingExecution.execution;
  invalid(() => buildMemoryPairedReport(off, missingExecution), /second run is invalid/);

  const missingEvidence = structuredClone(approved);
  missingEvidence.result.evidenceRefs = [];
  invalid(() => buildMemoryPairedReport(off, missingEvidence), /second run is invalid/);

  const sharedEvidence = structuredClone(approved);
  sharedEvidence.result.evidenceRefs.push(off.result.evidenceRefs[0]);
  invalid(() => buildMemoryPairedReport(off, sharedEvidence), /cross-arm contamination/);

  const foreignFeedback = structuredClone(approved);
  foreignFeedback.feedback[0].evidenceRefs = [off.result.evidenceRefs[0]];
  invalid(() => buildMemoryPairedReport(off, foreignFeedback), /second run is invalid/);
});

check('backup smoke evaluator proves the approved memory avoids the historical trap', async () => {
  const withoutMemory = await evaluateMemoryEffectivenessSmoke({
    runId: 'memory-off',
    observation: {
      arm: 'off',
      sortedVersions: ['1.10.0', '1.9.0', '2.0.0'],
      selectedMemoryIds: [],
      provenance: { boolean_facts: {} },
    },
    allowTestDouble: true,
  });
  const withMemory = await evaluateMemoryEffectivenessSmoke({
    runId: 'memory-approved',
    observation: {
      arm: 'approved_only',
      sortedVersions: ['1.9.0', '1.10.0', '2.0.0'],
      selectedMemoryIds: ['memory_semver_numeric_sort'],
      provenance: { boolean_facts: {} },
    },
    allowTestDouble: true,
  });
  assert.equal(withoutMemory.scorecard.total, 0);
  assert.equal(withMemory.scorecard.total, 100);
});

check('smoke Case is registered as backup without changing PRIMARY_CASES', () => {
  assert.deepEqual(PRIMARY_CASES, [
    'macro-map-3d-greenfield',
    'narrative-equity-relationship',
    'ainvest-market-heatmap-rebuild',
  ]);
  assert.equal(getCaseRuntime(root, 'memory-effectiveness-smoke').suiteRole, 'backup');
});

check('backup smoke Case completes the formal attested golden pipeline', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'vab-memory-golden-'));
  try {
    const spec = buildRunSpec({
      name: 'golden-memory-effectiveness-smoke',
      case_id: 'memory-effectiveness-smoke',
      engine: {
        adapter: 'codex-cli',
        executable: 'codex',
        configured_model: 'deterministic-fake',
        provider: 'local',
        credential_ref: 'secret://fake/not-used',
      },
      network: false,
      wall_time_minutes: 1,
      max_retries: 0,
    });
    const result = await runGoldenPipeline({
      projectRoot: root,
      spec,
      outRoot: temp,
      runId: 'golden-memory-smoke',
    });
    assert.equal(result.status, 'success', JSON.stringify(result, null, 2));
    const evaluation = JSON.parse(readFileSync(join(temp, 'golden-memory-smoke', 'evaluator-summary.json'), 'utf8'));
    assert.equal(evaluation.scorecard.total, 100);
    assert.equal(evaluation.evidence_trust.mode, 'control-plane-attested');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

check('memory-report CLI writes the same structured paired report without a model call', () => {
  const temp = mkdtempSync(join(tmpdir(), 'vab-memory-report-'));
  try {
    const outPath = join(temp, 'paired-report.json');
    const result = spawnSync(process.execPath, [
      join(root, 'scripts/bench.mjs'),
      'memory-report',
      '--off', offFixturePath,
      '--approved-only', approvedFixturePath,
      '--out', outPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const envelope = JSON.parse(result.stdout);
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(envelope.status, 'success');
    assert.equal(report.experimentId, 'exp-semver-001');
    assert.equal(validateMemoryPairedReport(report).valid, true);
    assert.equal(report.feedbackCounts.harmful, 1);
    assert.equal(report.deltas.cost.availability, 'unavailable');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

check('memory-report CLI rejects invalid input without leaving a partial report', () => {
  const temp = mkdtempSync(join(tmpdir(), 'vab-memory-report-invalid-'));
  try {
    const invalidPath = join(temp, 'invalid-approved.json');
    const outPath = join(temp, 'must-not-exist.json');
    const invalidApproved = structuredClone(approved);
    invalidApproved.intervention.contextPackHash = null;
    writeFileSync(invalidPath, JSON.stringify(invalidApproved));
    const result = spawnSync(process.execPath, [
      join(root, 'scripts/bench.mjs'),
      'memory-report',
      '--off', offFixturePath,
      '--approved-only', invalidPath,
      '--out', outPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stdout).status, 'error');
    assert.equal(existsSync(outPath), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

check('memory-report CLI refuses input aliases and existing output files', () => {
  const sourceBefore = readFileSync(offFixturePath, 'utf8');
  const aliasResult = spawnSync(process.execPath, [
    join(root, 'scripts/bench.mjs'),
    'memory-report',
    '--off', offFixturePath,
    '--approved-only', approvedFixturePath,
    '--out', offFixturePath,
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(aliasResult.status, 0);
  assert.equal(readFileSync(offFixturePath, 'utf8'), sourceBefore);

  const temp = mkdtempSync(join(tmpdir(), 'vab-memory-report-existing-'));
  try {
    const outPath = join(temp, 'existing.json');
    writeFileSync(outPath, '{"preserve":true}\n');
    const result = spawnSync(process.execPath, [
      join(root, 'scripts/bench.mjs'),
      'memory-report',
      '--off', offFixturePath,
      '--approved-only', approvedFixturePath,
      '--out', outPath,
    ], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(outPath, 'utf8'), '{"preserve":true}\n');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

check('concurrent memory-report publishers cannot clobber the winning output', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'vab-memory-report-race-'));
  try {
    const alternateApprovedPath = join(temp, 'approved-alternate.json');
    const outPath = join(temp, 'race-report.json');
    const alternateApproved = structuredClone(approved);
    alternateApproved.result.qualityScore = 80;
    writeFileSync(alternateApprovedPath, JSON.stringify(alternateApproved));
    const command = approvedPath => [
      join(root, 'scripts/bench.mjs'),
      'memory-report',
      '--off', offFixturePath,
      '--approved-only', approvedPath,
      '--out', outPath,
    ];
    const results = await Promise.all([
      spawnNode(command(approvedFixturePath)),
      spawnNode(command(alternateApprovedPath)),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [0, 1]);
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.ok([80, 100].includes(report.deltas.quality.value));
    assert.equal(validateMemoryPairedReport(report).valid, true);
    assert.equal(readdirSync(temp).some(name => name.includes('.tmp-')), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

const failures = [];
for (const [name, fn] of checks) {
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.stack });
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: failures.length ? 'error' : 'success',
  summary: `${checks.length - failures.length}/${checks.length} memory checks passed.`,
  next_actions: failures.length ? ['Fix failed memory checks.'] : [],
  artifacts: ['tests/memory/run.mjs', 'tests/memory/fixtures/off-run.json', 'tests/memory/fixtures/approved-run.json'],
  ...(failures.length ? { failures } : {}),
}, null, 2)}\n`);
if (failures.length) process.exitCode = 1;

function spawnNode(args) {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, args, { cwd: root, encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolvePromise({ status, stdout, stderr }));
  });
}
