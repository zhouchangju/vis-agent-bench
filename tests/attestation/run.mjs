import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectRunObservation,
  computeFileDigest,
} from '../../src/control-plane/run-observation-collector.mjs';
import { evaluateNarrativeEquity } from '../../src/evaluators/cases/narrative-equity/index.mjs';
import {
  resolveObservationInput,
  validateBooleanProvenance,
} from '../../src/evaluators/control/observation-attestation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..', '..');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function buildRunFixture({
  root,
  runId = 'test-run-001',
  caseId = 'narrative-equity-relationship',
  stageStatus = 'success',
  // Default mirrors the real bench.mjs verifyStageDeliverables gate shape:
  // { commands: [{ name, exit_code, signal, error, stdout, stderr }] }.
  checkpointGateCommands = [
    { name: 'build', exit_code: 0, signal: null, error: null, stdout: '', stderr: '' },
    { name: 'typecheck', exit_code: 0, signal: null, error: null, stdout: '', stderr: '' },
    { name: 'test', exit_code: 0, signal: null, error: null, stdout: '', stderr: '' },
  ],
  // Legacy { checks: [{ id, status, exit_code }] } shape for compat coverage.
  legacyGateChecks = null,
  includeBrowserEvidence = true,
  includeUsage = false,
  includeWorkspaceDiff = true,
}) {
  const checkpointGate = legacyGateChecks
    ? { checks: legacyGateChecks }
    : { status: 'success', stage_id: 'S0', commands: checkpointGateCommands };
  mkdirSync(join(root, 'logs', 'stages'), { recursive: true });
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  mkdirSync(join(root, 'workspace', '.fixture'), { recursive: true });

  const result = {
    status: stageStatus === 'success' ? 'success' : 'error',
    run_id: runId,
    case_id: caseId,
    duration_ms: 1234,
    stages: [
      {
        stage_id: 'S0',
        status: stageStatus,
        exit_code: stageStatus === 'success' ? 0 : 1,
        checkpoint_gate: checkpointGate,
      },
    ],
    usage: includeUsage
      ? { input_tokens: 100, output_tokens: 50, total_tokens: 150, cost_usd: 0.01 }
      : { availability: 'unavailable' },
    completed_at: '2026-07-20T00:00:00.000Z',
  };
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));

  writeFileSync(join(root, 'logs', 'commands.json'), JSON.stringify([
    {
      stage_id: 'S0',
      attempt: 1,
      executable: '/usr/bin/true',
      args: ['--prompt', '<PROMPT>'],
      cwd: join(root, 'workspace'),
    },
  ], null, 2));

  const manifest = {
    manifest_version: 1,
    produced_at: '2026-07-20T00:00:00.000Z',
    source_descriptor: { label: caseId, source_type: 'synthetic' },
    export: { fixture_digest: 'abc123', produced_at: '2026-07-20T00:00:00.000Z' },
  };
  writeFileSync(
    join(root, 'workspace', '.fixture', 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  if (includeWorkspaceDiff) {
    writeFileSync(join(root, 'artifacts', 'workspace.diff'), 'diff --git a/x b/y\n+hello\n');
  }

  if (includeBrowserEvidence) {
    writeFileSync(join(root, 'browser-evidence.json'), JSON.stringify({
      schema_version: 1,
      capture_id: `${runId}-browser`,
      run_id: runId,
      case_id: caseId,
      captured_at: '2026-07-20T00:00:00.000Z',
      availability: 'captured',
      steps: [{ kind: 'screenshot', label: 'final' }],
    }, null, 2));
  }
}

function buildFakeCaseRuntime(root, caseId = 'narrative-equity-relationship') {
  // Provide a minimal plan.yaml the collector can parse for baseline commands.
  const planPath = join(root, 'plan.yaml');
  writeFileSync(planPath, [
    'source:',
    `  label: "synthetic-${caseId}"`,
    '  type: synthetic',
    'baseline:',
    '  build:',
    '    command: ["npm", "run", "build"]',
    '    required: true',
    '  typecheck:',
    '    command: ["npm", "run", "typecheck"]',
    '    required: true',
    '  test:',
    '    command: ["npm", "test"]',
    '    required: true',
  ].join('\n'));
  return {
    caseId,
    starter: join(root, 'starter'),
    plan: planPath,
    caseDir: root,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// Test 1: unit — produces a contract-valid attestation
// ---------------------------------------------------------------------------

test('collectRunObservation produces an attestation that passes all contract validators', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-unit-'));
  try {
    buildRunFixture({ root });
    const caseRuntime = buildFakeCaseRuntime(root);
    const { observation, attestation, warnings } = await collectRunObservation({
      projectRoot: PROJECT_ROOT,
      runRoot: root,
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-001',
      caseRuntime,
    });

    // Collector wrote observation.json + binding documents.
    assert.ok(existsSync(join(root, 'observation.json')));
    assert.ok(existsSync(join(root, 'observation-attestation.json')) === false, 'collector must not write attestation itself');
    assert.ok(existsSync(join(root, 'command-evidence.json')));
    assert.ok(existsSync(join(root, 'hidden-control-execution.json')));

    // Envelope-level checks the evaluator performs in validateEnvelope.
    assert.equal(attestation.schema_version, 1);
    assert.equal(attestation.kind, 'trusted-observation-attestation');
    assert.equal(attestation.run_id, 'test-run-001');
    assert.equal(attestation.case_id, 'narrative-equity-relationship');
    assert.equal(typeof attestation.collected_at, 'string');
    assert.ok(attestation.collector.id.length > 0);
    assert.equal(attestation.collector.demo_only, false);
    assert.equal(attestation.collector.conclusion_eligible, true);

    // All six bindings present and digests match real bytes on disk.
    for (const name of [
      'observation',
      'fixture_manifest',
      'command_evidence',
      'workspace_diff_evidence',
      'browser_evidence',
      'hidden_control_execution',
    ]) {
      const binding = attestation.bindings[name];
      assert.ok(binding, `missing binding ${name}`);
      assert.ok(binding.path && binding.sha256);
      assert.equal(computeFileDigest(join(root, binding.path)), binding.sha256, `${name} digest mismatch`);
    }

    // validateBooleanProvenance via the production resolver path.
    // Write the attestation to disk first because resolveObservationInput reads from disk.
    writeFileSync(join(root, 'observation-attestation.json'), JSON.stringify(attestation, null, 2));
    const resolved = resolveObservationInput({
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-001',
      runRoot: root,
      attestationPath: 'observation-attestation.json',
    });
    assert.equal(resolved.trust.mode, 'control-plane-attested');
    assert.equal(resolved.trust.conclusion_eligible, true);

    // Every boolean in the observation has a provenance entry.
    validateBooleanProvenance(resolved.observation, {
      bindingDigests: Object.fromEntries(
        Object.entries(attestation.bindings).map(([k, v]) => [k, v.sha256]),
      ),
      bindingDocuments: Object.fromEntries(
        Object.entries(attestation.bindings).map(([name, binding]) => {
          const raw = readFileSync(join(root, binding.path), 'utf8');
          let doc = null;
          try { doc = JSON.parse(raw); } catch { doc = null; }
          return [name, doc];
        }),
      ),
    });

    // No warnings expected for the fully-populated fixture.
    assert.deepEqual(warnings, []);
    assert.equal(observation.run.status, 'success');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: missing browser evidence still produces a valid attestation
// ---------------------------------------------------------------------------

test('missing browser evidence emits an unavailable marker and still validates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-nobrowser-'));
  try {
    buildRunFixture({ root, includeBrowserEvidence: false });
    const caseRuntime = buildFakeCaseRuntime(root);
    const { attestation, warnings } = await collectRunObservation({
      projectRoot: PROJECT_ROOT,
      runRoot: root,
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-nobrowser',
      caseRuntime,
    });

    // Browser evidence file now exists as an explicit unavailable marker.
    const browserBinding = attestation.bindings.browser_evidence;
    assert.ok(browserBinding);
    assert.equal(computeFileDigest(join(root, browserBinding.path)), browserBinding.sha256);
    const browserDoc = JSON.parse(readFileSync(join(root, browserBinding.path), 'utf8'));
    assert.equal(browserDoc.availability, 'unavailable');
    assert.deepEqual(browserDoc.steps, []);

    // Collector must warn so users know no real capture happened.
    assert.ok(warnings.some(w => /browser evidence/i.test(w)));

    // Resolver still accepts it because the binding file exists with correct digest.
    writeFileSync(join(root, 'observation-attestation.json'), JSON.stringify(attestation, null, 2));
    const resolved = resolveObservationInput({
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-nobrowser',
      runRoot: root,
      attestationPath: 'observation-attestation.json',
    });
    assert.equal(resolved.trust.mode, 'control-plane-attested');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: failure recovery — missing required binding throws a structured error
// ---------------------------------------------------------------------------

test('missing fixture manifest throws a structured error with code + root_cause_hint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-nomanifest-'));
  try {
    buildRunFixture({ root });
    // Delete the required fixture manifest.
    rmSync(join(root, 'workspace', '.fixture', 'manifest.json'));
    const caseRuntime = buildFakeCaseRuntime(root);
    await assert.rejects(
      () => collectRunObservation({
        projectRoot: PROJECT_ROOT,
        runRoot: root,
        caseId: 'narrative-equity-relationship',
        runId: 'test-run-nomanifest',
        caseRuntime,
      }),
      (err) => {
        assert.ok(err.code, 'error must carry a code');
        assert.equal(err.code, 'FIXTURE_MANIFEST_MISSING');
        assert.ok(err.root_cause_hint, 'error must carry root_cause_hint');
        assert.ok(err.safe_retry, 'error must carry safe_retry');
        assert.ok(err.stop_condition, 'error must carry stop_condition');
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing result.json throws RESULT_JSON_MISSING with structured fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-noresult-'));
  try {
    // Build fixture but then remove result.json.
    buildRunFixture({ root });
    rmSync(join(root, 'result.json'));
    const caseRuntime = buildFakeCaseRuntime(root);
    await assert.rejects(
      () => collectRunObservation({
        projectRoot: PROJECT_ROOT,
        runRoot: root,
        caseId: 'narrative-equity-relationship',
        runId: 'test-run-noresult',
        caseRuntime,
      }),
      (err) => {
        assert.equal(err.code, 'RESULT_JSON_MISSING');
        assert.ok(err.root_cause_hint);
        assert.ok(err.safe_retry);
        assert.ok(err.stop_condition);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: no-fabrication — failed stages / missing checkpoint evidence yield false
// ---------------------------------------------------------------------------

test('failed build stage yields commands.build.ran=false (no fabrication)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-nofabric-'));
  try {
    // Stage ran but checkpoint gate did not produce a build check entry.
    buildRunFixture({
      root,
      stageStatus: 'error',
      checkpointGateCommands: [], // no build/typecheck/test evidence
    });
    const caseRuntime = buildFakeCaseRuntime(root);
    const { observation } = await collectRunObservation({
      projectRoot: PROJECT_ROOT,
      runRoot: root,
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-nofabric',
      caseRuntime,
    });

    // Build/test/typecheck commands have no checkpoint evidence, so ran must be false.
    for (const name of ['build', 'typecheck', 'test']) {
      const cmd = observation.commands?.[name];
      assert.ok(cmd, `commands.${name} must be present`);
      assert.equal(cmd.ran, false, `commands.${name}.ran must not be fabricated`);
      assert.equal(cmd.exitCode, null, `commands.${name}.exitCode must not be fabricated`);
    }

    // The dsl block must reflect that no control inputs were executed.
    assert.equal(observation.dsl.control_inputs_executed, false);

    // Run-level status reflects the failed stage.
    assert.equal(observation.run.status, 'error');
    assert.equal(observation.run.completed_stage_count, 0);

    // usage must be unavailable because we did not emit tokens.
    assert.equal(observation.run.usage.availability, 'unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('successful build checkpoint yields commands.build.ran=true with exit_code 0', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-realbuild-'));
  try {
    buildRunFixture({
      root,
      stageStatus: 'success',
      checkpointGateCommands: [
        { name: 'build', exit_code: 0, signal: null, error: null, stdout: '', stderr: '' },
        // typecheck and test intentionally missing to prove no fabrication
      ],
    });
    const caseRuntime = buildFakeCaseRuntime(root);
    const { observation } = await collectRunObservation({
      projectRoot: PROJECT_ROOT,
      runRoot: root,
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-realbuild',
      caseRuntime,
    });
    assert.equal(observation.commands.build.ran, true);
    assert.equal(observation.commands.build.exitCode, 0);
    assert.equal(observation.commands.typecheck.ran, false);
    assert.equal(observation.commands.typecheck.exitCode, null);
    assert.equal(observation.commands.test.ran, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: legacy gate shape ({ checks: [...] }) is still detected
// ---------------------------------------------------------------------------

test('legacy checkpoint_gate.checks shape still maps into command outcomes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-legacy-'));
  try {
    buildRunFixture({
      root,
      stageStatus: 'success',
      legacyGateChecks: [
        { id: 'build', status: 'pass', exit_code: 0 },
        { id: 'typecheck', status: 'pass', exit_code: 0 },
      ],
    });
    const caseRuntime = buildFakeCaseRuntime(root);
    const { observation } = await collectRunObservation({
      projectRoot: PROJECT_ROOT,
      runRoot: root,
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-legacy',
      caseRuntime,
    });
    assert.equal(observation.commands.build.ran, true);
    assert.equal(observation.commands.build.exitCode, 0);
    assert.equal(observation.commands.typecheck.ran, true);
    assert.equal(observation.commands.test.ran, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7: full chain — collector observation feeds the case evaluator
// ---------------------------------------------------------------------------

test('collector observation validates through the narrative-equity evaluator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vab-attest-evalchain-'));
  try {
    buildRunFixture({ root });
    const caseRuntime = buildFakeCaseRuntime(root);
    const { attestation } = await collectRunObservation({
      projectRoot: PROJECT_ROOT,
      runRoot: root,
      caseId: 'narrative-equity-relationship',
      runId: 'test-run-evalchain',
      caseRuntime,
    });
    writeFileSync(join(root, 'observation-attestation.json'), JSON.stringify(attestation, null, 2));

    // Production evaluator path: attestation only, no bare observation.
    // Before the contract fix this threw "Narrative equity observation is
    // missing \"overview\"" instead of evaluating at all.
    const evaluation = await evaluateNarrativeEquity({
      runId: 'test-run-evalchain',
      runRoot: root,
      attestationPath: 'observation-attestation.json',
    });

    // The baseline gate evidence must flow through: a run whose gate recorded
    // build/typecheck/test exit 0 passes build-and-typecheck even though the
    // conservative real-run observation carries no golden-only sections.
    // Overall status stays 'error' by design: the hidden-control hard gates
    // cannot pass without golden evidence, and the collector never fabricates.
    const baseline = evaluation.bundle.results.find(item => item.check_id === 'build-and-typecheck');
    assert.ok(baseline, 'build-and-typecheck result missing');
    assert.equal(baseline.status, 'pass', JSON.stringify(baseline.evidence, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let failed = 0;
for (const entry of tests) {
  try {
    await entry.fn();
    process.stdout.write(`PASS ${entry.name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${entry.name}\n${error.stack}\n`);
  }
}

if (failed === 0) {
  process.stdout.write(`Attestation collector: ${tests.length}/${tests.length} tests passed.\n`);
} else {
  process.exitCode = 1;
  process.stdout.write(`Attestation collector: ${tests.length - failed}/${tests.length} tests passed.\n`);
}
