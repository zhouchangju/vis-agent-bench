import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { semiAutomaticAdapter } from '../../../src/runners/semi-automatic-adapter.mjs';
import {
  stagePrompt,
  loadScenario,
  isFinalStage,
  verifyCheckpointGate,
  baselinePackageGate,
  getSemiAutoStatus,
} from '../../../src/runners/semi-automatic-session.mjs';
import { getAdapter, listAdapters } from '../../../src/runners/adapters.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tmpDir(prefix = 'vab-test') {
  const dir = join(tmpdir(), `${prefix}-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const checks = [];

function check(name, fn) {
  checks.push([name, fn]);
}

// ---------------------------------------------------------------------------
// Adapter tests
// ---------------------------------------------------------------------------

check('semi-auto adapter is registered in listAdapters', () => {
  const adapters = listAdapters();
  const semi = adapters.find(a => a.id === 'semi-auto');
  assert.ok(semi, 'semi-auto adapter not in listAdapters');
  assert.equal(semi.label, 'Semi-automatic (manual client)');
  assert.equal(semi.session_continuity, 'manual-checkpoint');
});

check('getAdapter("semi-auto") returns semiAutomaticAdapter', () => {
  const adapter = getAdapter('semi-auto');
  assert.equal(adapter.id, 'semi-auto');
  assert.equal(adapter.label, 'Semi-automatic (manual client)');
});

check('getAdapter("semi-automatic") also returns the adapter', () => {
  const adapter = getAdapter('semi-automatic');
  assert.equal(adapter.id, 'semi-auto');
});

check('semi-auto adapter has no build/buildCommand (never spawns CLI)', () => {
  const adapter = getAdapter('semi-auto');
  assert.equal(typeof adapter.build, 'undefined');
  assert.equal(typeof adapter.buildCommand, 'undefined');
  assert.equal(typeof adapter.executable, 'undefined');
  assert.equal(typeof adapter.versionArgs, 'undefined');
});

// ---------------------------------------------------------------------------
// prepare tests
// ---------------------------------------------------------------------------

check('prepare writes README-SEMI-AUTO.md and first stage prompt', async () => {
  const dir = tmpDir('vab-prepare');
  const inputDir = join(dir, 'input');
  const workspaceDir = join(dir, 'workspace');
  const logsDir = join(dir, 'logs');
  mkdirSync(inputDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const scenario = {
    mode: 'progressive-disclosure',
    stages: [
      { id: 'S0', name: 'Understand', checkpoint: ['requirement-ledger.yaml'] },
      { id: 'S1', name: 'Implement', checkpoint: ['candidate-delivery'] },
    ],
  };

  const stagePromptResolver = (stageId) => {
    const stage = scenario.stages.find(s => s.id === stageId);
    return `# Stage ${stageId}: ${stage.name}\n\nPrompt content for ${stageId}.`;
  };

  const result = await semiAutomaticAdapter.prepare({
    paths: { inputDir, workspaceDir, logsDir, runDir: dir },
    scenario,
    stagePrompt: stagePromptResolver,
  });

  assert.equal(result.status, 'awaiting_user');
  assert.equal(result.stageId, 'S0');

  // README exists.
  const readmePath = join(dir, 'README-SEMI-AUTO.md');
  assert.ok(existsSync(readmePath), 'README-SEMI-AUTO.md missing');
  const readme = readFileSync(readmePath, 'utf8');
  assert.ok(readme.includes('Semi-automatic Benchmark Run'));
  assert.ok(readme.includes('How to use this run'));
  assert.ok(readme.includes(workspaceDir));

  // First stage prompt exists.
  const promptPath = join(inputDir, 'stage-S0.md');
  assert.ok(existsSync(promptPath), 'stage-S0.md missing');
  const prompt = readFileSync(promptPath, 'utf8');
  assert.ok(prompt.includes('Stage S0: Understand'));

  // Checkpoints dir created.
  assert.ok(existsSync(join(workspaceDir, '.vab', 'checkpoints')), '.vab/checkpoints missing');

  cleanup(dir);
});

check('prepare with single stage works', async () => {
  const dir = tmpDir('vab-prepare-single');
  const inputDir = join(dir, 'input');
  const workspaceDir = join(dir, 'workspace');
  const logsDir = join(dir, 'logs');
  mkdirSync(inputDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const scenario = {
    mode: 'progressive-disclosure',
    stages: [
      { id: 'A1', name: 'Task', checkpoint: ['final-requirement-ledger'] },
    ],
  };

  const result = await semiAutomaticAdapter.prepare({
    paths: { inputDir, workspaceDir, logsDir, runDir: dir },
    scenario,
    stagePrompt: (id) => `Prompt for ${id}`,
  });

  assert.equal(result.status, 'awaiting_user');
  assert.equal(result.stageId, 'A1');

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// checkStageCompletion tests
// ---------------------------------------------------------------------------

check('checkStageCompletion returns incomplete when no checkpoint file', async () => {
  const dir = tmpDir('vab-check');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(join(workspaceDir, '.vab', 'checkpoints'), { recursive: true });

  const result = await semiAutomaticAdapter.checkStageCompletion(
    { paths: { workspaceDir } },
    'S0',
  );

  assert.equal(result.completed, false);
  assert.equal(result.reason, 'checkpoint_file_missing');

  cleanup(dir);
});

check('checkStageCompletion returns complete for valid checkpoint', async () => {
  const dir = tmpDir('vab-check-valid');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(join(workspaceDir, '.vab', 'checkpoints'), { recursive: true });

  writeFileSync(
    join(workspaceDir, '.vab', 'checkpoints', 'S0.json'),
    JSON.stringify({ schema_version: 1, stage_id: 'S0', artifacts: { 'my-check': ['file.txt'] } }),
  );

  const result = await semiAutomaticAdapter.checkStageCompletion(
    { paths: { workspaceDir } },
    'S0',
  );

  assert.equal(result.completed, true);
  assert.ok(result.checkpoint);
  assert.equal(result.checkpoint.schema_version, 1);
  assert.equal(result.checkpoint.stage_id, 'S0');

  cleanup(dir);
});

check('checkStageCompletion rejects invalid identity checkpoint', async () => {
  const dir = tmpDir('vab-check-bad');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(join(workspaceDir, '.vab', 'checkpoints'), { recursive: true });

  writeFileSync(
    join(workspaceDir, '.vab', 'checkpoints', 'S0.json'),
    JSON.stringify({ schema_version: 1, stage_id: 'S1', artifacts: {} }),
  );

  const result = await semiAutomaticAdapter.checkStageCompletion(
    { paths: { workspaceDir } },
    'S0',
  );

  assert.equal(result.completed, false);
  assert.equal(result.reason, 'checkpoint_identity_mismatch');

  cleanup(dir);
});

check('checkStageCompletion handles malformed JSON', async () => {
  const dir = tmpDir('vab-check-malformed');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(join(workspaceDir, '.vab', 'checkpoints'), { recursive: true });

  writeFileSync(
    join(workspaceDir, '.vab', 'checkpoints', 'S0.json'),
    'not valid json',
  );

  const result = await semiAutomaticAdapter.checkStageCompletion(
    { paths: { workspaceDir } },
    'S0',
  );

  assert.equal(result.completed, false);
  assert.equal(result.reason, 'checkpoint_parse_error');

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// advanceStage tests
// ---------------------------------------------------------------------------

check('advanceStage writes stage prompt and creates checkpoint dir', async () => {
  const dir = tmpDir('vab-advance');
  const inputDir = join(dir, 'input');
  const workspaceDir = join(dir, 'workspace');
  const logsDir = join(dir, 'logs');
  mkdirSync(inputDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const scenario = {
    stages: [
      { id: 'S1', name: 'Build', checkpoint: ['build-output'] },
    ],
  };

  const stagePromptResolver = (id) => `# Stage ${id}\n\nBuild the thing.`;

  const result = await semiAutomaticAdapter.advanceStage(
    { paths: { inputDir, workspaceDir, logsDir, runDir: dir }, scenario, stagePrompt: stagePromptResolver },
    'S1',
  );

  assert.equal(result.status, 'stage_ready');
  assert.equal(result.stageId, 'S1');

  const promptPath = join(inputDir, 'stage-S1.md');
  assert.ok(existsSync(promptPath));
  const prompt = readFileSync(promptPath, 'utf8');
  assert.ok(prompt.includes('Stage S1'));
  assert.ok(prompt.includes('Build the thing'));

  // Checkpoints dir created.
  assert.ok(existsSync(join(workspaceDir, '.vab', 'checkpoints')));

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// stagePrompt tests
// ---------------------------------------------------------------------------

check('stagePrompt generates content from stakeholder_message', () => {
  const dir = tmpDir('vab-prompt');
  const caseDir = join(dir, 'case');
  const scenarioDir = join(caseDir, 'scenario');
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(join(caseDir, 'case.yaml'), 'task_type: default\n');

  const stage = {
    id: 'S0',
    name: 'Test Stage',
    stakeholder_message: 'Here is a stakeholder message.',
    checkpoint: ['file-a.txt'],
  };
  const scenario = { mode: 'progressive-disclosure', stages: [stage] };

  const prompt = stagePrompt(caseDir, scenario, stage);
  assert.ok(prompt.includes('Here is a stakeholder message.'));
  assert.ok(prompt.includes('本阶段交付协议'));
  assert.ok(prompt.includes('当前阶段：S0 / Test Stage'));

  cleanup(dir);
});

check('stagePrompt reads from input file when specified', () => {
  const dir = tmpDir('vab-prompt-file');
  const caseDir = join(dir, 'case');
  const scenarioDir = join(caseDir, 'scenario');
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(join(caseDir, 'case.yaml'), 'task_type: default\n');
  writeFileSync(join(scenarioDir, 'my-input.md'), 'Input file content.');

  const stage = {
    id: 'S0',
    name: 'Test',
    input: 'my-input.md',
    checkpoint: ['file-a.txt'],
  };
  const scenario = { mode: 'progressive-disclosure', stages: [stage] };

  const prompt = stagePrompt(caseDir, scenario, stage);
  assert.ok(prompt.includes('Input file content.'));

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// verifyCheckpointGate tests
// ---------------------------------------------------------------------------

check('verifyCheckpointGate requires requirement-ledger.yaml', () => {
  const dir = tmpDir('vab-gate-missing');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });

  const stage = { id: 'S0', checkpoint: ['some-artifact'] };
  const gate = verifyCheckpointGate(workspaceDir, stage);

  assert.equal(gate.status, 'error');
  assert.ok(gate.missing.includes('requirement-ledger.yaml'));

  cleanup(dir);
});

check('verifyCheckpointGate passes with requirement-ledger.yaml and checkpoints', () => {
  const dir = tmpDir('vab-gate-pass');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(workspaceDir, '.vab', 'checkpoints'), { recursive: true });

  writeFileSync(join(workspaceDir, 'requirement-ledger.yaml'), 'confirmed: []\ndecisions: []');
  writeFileSync(join(workspaceDir, '.vab', 'checkpoints', 'S0.json'), JSON.stringify({
    schema_version: 1,
    stage_id: 'S0',
    artifacts: { 'my-artifact': ['evidence.txt'] },
  }));
  writeFileSync(join(workspaceDir, 'evidence.txt'), 'evidence');

  const stage = { id: 'S0', checkpoint: ['my-artifact'] };
  const gate = verifyCheckpointGate(workspaceDir, stage);

  assert.equal(gate.status, 'success');
  assert.equal(gate.missing.length, 0);

  cleanup(dir);
});

check('verifyCheckpointGate fails with missing checkpoint evidence', () => {
  const dir = tmpDir('vab-gate-missing-evidence');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(workspaceDir, '.vab', 'checkpoints'), { recursive: true });

  writeFileSync(join(workspaceDir, 'requirement-ledger.yaml'), 'confirmed: []\ndecisions: []');
  writeFileSync(join(workspaceDir, '.vab', 'checkpoints', 'S0.json'), JSON.stringify({
    schema_version: 1,
    stage_id: 'S0',
    artifacts: { 'my-artifact': ['nonexistent.txt'] },
  }));

  const stage = { id: 'S0', checkpoint: ['my-artifact'] };
  const gate = verifyCheckpointGate(workspaceDir, stage);

  assert.equal(gate.status, 'error');
  assert.ok(gate.missing.some(m => m.includes('my-artifact') && m.includes('nonexistent')));

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// isFinalStage tests
// ---------------------------------------------------------------------------

check('isFinalStage detects final stage markers', () => {
  assert.equal(isFinalStage({ checkpoint: ['candidate-delivery'] }), true);
  assert.equal(isFinalStage({ checkpoint: ['final-requirement-ledger'] }), true);
  assert.equal(isFinalStage({ checkpoint: ['other-thing'] }), false);
  assert.equal(isFinalStage({ checkpoint: [] }), false);
});

// ---------------------------------------------------------------------------
// loadScenario tests
// ---------------------------------------------------------------------------

check('loadScenario reads stages.yaml', () => {
  const dir = tmpDir('vab-scenario');
  const caseDir = join(dir, 'case');
  const scenarioDir = join(caseDir, 'scenario');
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(join(scenarioDir, 'stages.yaml'), [
    'mode: progressive-disclosure',
    'stages:',
    '  - id: S0',
    '    name: Setup',
    '    checkpoint:',
    '      - req-1',
  ].join('\n'));

  const scenario = loadScenario(caseDir);
  assert.equal(scenario.mode, 'progressive-disclosure');
  assert.equal(scenario.stages.length, 1);
  assert.equal(scenario.stages[0].id, 'S0');

  cleanup(dir);
});

check('loadScenario rejects empty stages', () => {
  const dir = tmpDir('vab-scenario-empty');
  const caseDir = join(dir, 'case');
  const scenarioDir = join(caseDir, 'scenario');
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(join(scenarioDir, 'stages.yaml'), 'mode: progressive-disclosure\nstages: []\n');

  assert.throws(() => loadScenario(caseDir), /no stages/);

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// baselinePackageGate tests
// ---------------------------------------------------------------------------

check('baselinePackageGate returns empty gate when no package.json', () => {
  const dir = tmpDir('vab-gate-empty');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });

  const gate = baselinePackageGate(workspaceDir);
  assert.deepEqual(gate, { scripts: {}, protected_files: [] });

  cleanup(dir);
});

check('baselinePackageGate extracts build/test scripts from package.json', () => {
  const dir = tmpDir('vab-gate-pkg');
  const workspaceDir = join(dir, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({
    scripts: { build: 'tsc', typecheck: 'tsc --noEmit', test: 'jest' },
  }));

  const gate = baselinePackageGate(workspaceDir);
  assert.deepEqual(gate.scripts, { build: 'tsc', typecheck: 'tsc --noEmit', test: 'jest' });

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// getSemiAutoStatus tests
// ---------------------------------------------------------------------------

check('getSemiAutoStatus returns unknown when no state file', async () => {
  const dir = tmpDir('vab-status-none');
  const result = await getSemiAutoStatus(dir);
  assert.equal(result.status, 'unknown');
  assert.ok(result.error);

  cleanup(dir);
});

check('getSemiAutoStatus reports waiting state', async () => {
  const dir = tmpDir('vab-status-waiting');
  writeFileSync(join(dir, 'run-state.json'), JSON.stringify({
    schema_version: 1,
    run_id: 'test-123',
    status: 'semi-auto-waiting',
    scenario: {
      stage_ids: ['S0', 'S1'],
      current_stage: 'S0',
      completed_stages: [],
    },
  }));
  mkdirSync(join(dir, 'workspace', '.vab', 'checkpoints'), { recursive: true });

  const result = await getSemiAutoStatus(dir);
  assert.equal(result.status, 'semi-auto-waiting');
  assert.equal(result.waitingOnStage, 'S0');
  assert.deepEqual(result.completedStages, []);
  assert.deepEqual(result.remainingStages, ['S0', 'S1']);
  assert.equal(result.checkpointExists, false);

  cleanup(dir);
});

check('getSemiAutoStatus detects existing checkpoint', async () => {
  const dir = tmpDir('vab-status-checkpoint');
  writeFileSync(join(dir, 'run-state.json'), JSON.stringify({
    schema_version: 1,
    run_id: 'test-456',
    status: 'semi-auto-waiting',
    scenario: {
      stage_ids: ['S0', 'S1'],
      current_stage: 'S0',
      completed_stages: [],
    },
  }));
  mkdirSync(join(dir, 'workspace', '.vab', 'checkpoints'), { recursive: true });
  writeFileSync(
    join(dir, 'workspace', '.vab', 'checkpoints', 'S0.json'),
    JSON.stringify({ schema_version: 1, stage_id: 'S0', artifacts: {} }),
  );

  const result = await getSemiAutoStatus(dir);
  assert.equal(result.checkpointExists, true);

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

const failures = [];
for (const [name, fn] of checks) {
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.message });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  }
}

const payload = {
  status: failures.length ? 'error' : 'success',
  summary: `${checks.length - failures.length}/${checks.length} semi-automatic runner checks passed.`,
  next_actions: failures.length ? failures.map(f => `Fix: ${f.name}`) : [],
  artifacts: ['tests/runners/semi-automatic/run.mjs'],
};
if (failures.length) payload.failures = failures;

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
