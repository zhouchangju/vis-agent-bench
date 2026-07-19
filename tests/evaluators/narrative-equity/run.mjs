import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  GEOMETRY_TOLERANCE,
  DEFAULT_CONTROL_INPUTS,
  canonicalState,
  evaluateNarrativeEquity,
  overlapRatio,
  statesEqual,
  validateCheckMapping,
} from '../../../src/evaluators/cases/narrative-equity/index.mjs';
import { loadNarrativeEquityRubric } from '../../../src/evaluators/cases/narrative-equity/rubric.mjs';
import { collectBooleanPaths } from '../../../src/evaluators/control/observation-attestation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const compliant = asTestDouble(readJson('samples/minimal-compliant.json'));
const faultyOverlay = readJson('samples/intentional-failure.json');
const faulty = merge(compliant, faultyOverlay.overrides);
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('rubric check IDs, hard gates, and actual assertions are one-to-one', () => {
  const mapping = validateCheckMapping(loadNarrativeEquityRubric());
  assert.equal(mapping.declared.length, 39);
  assert.equal(mapping.hardGates.length, 5);
  assert.ok(mapping.hardGates.every(id => mapping.declared.includes(id)));
});

test('default control inputs include public valid/boundary and hidden invalid fixtures', () => {
  assert.deepEqual(Object.keys(DEFAULT_CONTROL_INPUTS).sort(), ['boundary', 'invalid', 'valid']);
  assert.ok(Object.values(DEFAULT_CONTROL_INPUTS).every(existsSync));
  assert.match(DEFAULT_CONTROL_INPUTS.invalid, /fixture\/control\/invalid-input\.json$/);
});

test('canonical state ignores ordering and sub-pixel noise', () => {
  assert.equal(statesEqual(
    { visibleIds: ['b', 'a'], opacities: { b: 0.35001, a: 1 } },
    { opacities: { a: 1, b: 0.35 }, visibleIds: ['a', 'b'] },
  ), true);
  assert.deepEqual(Object.keys(canonicalState({ view: 'overview', timerId: 9 })), ['view']);
});

test('geometry overlap threshold has an explicit 8% boundary', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  const b = { x: 92, y: 0, width: 100, height: 100 };
  assert.equal(overlapRatio(a, b), GEOMETRY_TOLERANCE.severeOverlapRatio);
});

test('minimal compliant test double passes every deterministic check', async () => {
  const evaluation = await evaluateNarrativeEquity({
    observation: structuredClone(compliant),
    runId: 'minimal-pass',
    allowTestDouble: true,
  });
  assert.equal(evaluation.status, 'success');
  assert.equal(evaluation.scorecard.total, 100);
  assert.equal(evaluation.bundle.results.length, 39);
  assert.deepEqual([...new Set(evaluation.bundle.results.map(item => item.status))], ['pass']);
  assert.equal(evaluation.bundle.evidence_trust.mode, 'test-double');
  assert.equal(evaluation.bundle.evidence_trust.conclusion_eligible, false);
});

test('intentionally wrong sample fails build, overlap, navigation, and cleanup gates', async () => {
  const evaluation = await evaluateNarrativeEquity({
    observation: faulty,
    runId: 'intentional-failure',
    allowTestDouble: true,
  });
  const failed = new Set(evaluation.bundle.results.filter(item => item.status === 'fail').map(item => item.check_id));
  for (const id of [
    'build-and-typecheck',
    'no-critical-layout-overlap',
    'deterministic-chapter-navigation',
    'lifecycle-cleanup',
  ]) {
    assert.ok(failed.has(id), `${id} should fail`);
  }
  assert.equal(evaluation.status, 'error');
  assert.equal(evaluation.scorecard.total, 0);
  assert.ok(evaluation.scorecard.hard_gates.failing.length >= 4);
  const layoutFailure = evaluation.bundle.results.find(item => item.check_id === 'node-node-overlap');
  assert.ok(layoutFailure.evidence.details.failures[0].ratio > GEOMETRY_TOLERANCE.severeOverlapRatio);
  assert.ok(layoutFailure.artifacts.includes('artifacts/fixed-viewport.png'));
});

test('production input rejects bare observations and accepts a contained digest-bound attestation', async () => {
  await assert.rejects(
    () => evaluateNarrativeEquity({ observation: compliant, runId: 'bare' }),
    /reject bare observation/,
  );

  const runRoot = mkdtempSync(join(tmpdir(), 'vab-t16-attested-'));
  const runId = 'attested-run';
  const sourceObservation = readJson('samples/minimal-compliant.json');
  const evidence = {
    fixture_manifest: '{"fixture":"v1"}',
    command_evidence: JSON.stringify({ commands: sourceObservation.commands }),
    browser_evidence: JSON.stringify(sourceObservation),
    hidden_control_execution: JSON.stringify({ dsl: sourceObservation.dsl }),
  };
  const digests = {};
  for (const [name, content] of Object.entries(evidence)) {
    writeFileSync(join(runRoot, `${name}.json`), content);
    digests[name] = sha256(content);
  }
  const productionObservation = asProductionObservation(
    sourceObservation,
    digests,
  );
  const observationText = JSON.stringify(productionObservation);
  writeFileSync(join(runRoot, 'observation.json'), observationText);
  const attestation = {
    schema_version: 1,
    kind: 'trusted-observation-attestation',
    run_id: runId,
    case_id: 'narrative-equity-relationship',
    collector: { id: 'control-plane-collector', version: 'test-v1' },
    bindings: {
      observation: { path: 'observation.json', sha256: sha256(observationText) },
      ...Object.fromEntries(Object.keys(evidence).map(name => [
        name,
        { path: `${name}.json`, sha256: digests[name] },
      ])),
    },
  };
  writeFileSync(join(runRoot, 'attestation.json'), JSON.stringify(attestation));

  const evaluation = await evaluateNarrativeEquity({
    runId,
    runRoot,
    attestationPath: 'attestation.json',
  });
  assert.equal(evaluation.status, 'success');
  assert.equal(evaluation.bundle.evidence_trust.mode, 'control-plane-attested');
  assert.equal(evaluation.bundle.evidence_trust.conclusion_eligible, true);

  const dangling = structuredClone(productionObservation);
  dangling.provenance.boolean_facts['/behavior/camera_focus'][0].locator = '/missing';
  const danglingText = JSON.stringify(dangling);
  writeFileSync(join(runRoot, 'dangling-observation.json'), danglingText);
  attestation.bindings.observation = {
    path: 'dangling-observation.json',
    sha256: sha256(danglingText),
  };
  writeFileSync(join(runRoot, 'dangling-attestation.json'), JSON.stringify(attestation));
  await assert.rejects(
    () => evaluateNarrativeEquity({
      runId,
      runRoot,
      attestationPath: 'dangling-attestation.json',
    }),
    /locator does not exist/,
  );
  attestation.bindings.observation = {
    path: 'observation.json',
    sha256: sha256(observationText),
  };

  const outside = join(tmpdir(), `vab-t16-outside-${process.pid}.json`);
  writeFileSync(outside, evidence.browser_evidence);
  symlinkSync(outside, join(runRoot, 'escaped-browser.json'));
  attestation.bindings.browser_evidence.path = 'escaped-browser.json';
  writeFileSync(join(runRoot, 'escaped-attestation.json'), JSON.stringify(attestation));
  await assert.rejects(
    () => evaluateNarrativeEquity({
      runId,
      runRoot,
      attestationPath: 'escaped-attestation.json',
    }),
    /realpath escapes/,
  );

  attestation.bindings.browser_evidence.path = 'browser_evidence.json';
  attestation.bindings.browser_evidence.sha256 = '0'.repeat(64);
  writeFileSync(join(runRoot, 'tampered-attestation.json'), JSON.stringify(attestation));
  await assert.rejects(
    () => evaluateNarrativeEquity({
      runId,
      runRoot,
      attestationPath: 'tampered-attestation.json',
    }),
    /SHA-256 mismatch/,
  );
});

test('missing conclusion provenance is rejected even in explicit test-double mode', async () => {
  const missing = structuredClone(compliant);
  delete missing.provenance.boolean_facts['/behavior/camera_focus'];
  await assert.rejects(
    () => evaluateNarrativeEquity({
      observation: missing,
      runId: 'missing-provenance',
      allowTestDouble: true,
    }),
    /camera_focus.*missing provenance/,
  );
});

test('geometry evidence fails closed for malformed edges, bounds, and position snapshots', async () => {
  const adversarial = [
    {
      name: 'missing node bounds',
      check: 'node-node-overlap',
      mutate(observation) {
        delete observation.overview.nodes[0].bounds;
        delete observation.overview.nodes[0].imageBounds;
      },
      reason: 'missing-or-invalid-bounds',
    },
    {
      name: 'missing edge path',
      check: 'edge-endpoint-boundary',
      mutate(observation) {
        delete observation.overview.edges[0].path;
      },
      reason: 'missing-or-invalid-path',
    },
    {
      name: 'missing edge source',
      check: 'edge-endpoint-boundary',
      mutate(observation) {
        delete observation.overview.edges[0].source;
      },
      reason: 'missing-edge-id-source-or-target',
    },
    {
      name: 'unknown edge target',
      check: 'edge-endpoint-boundary',
      mutate(observation) {
        observation.overview.edges[0].target = 'unknown-node';
      },
      reason: 'unknown-endpoint',
    },
    {
      name: 'missing edge target',
      check: 'edge-endpoint-boundary',
      mutate(observation) {
        delete observation.overview.edges[0].target;
      },
      reason: 'missing-edge-id-source-or-target',
    },
    {
      name: 'no common snapshot entity',
      check: 'overview-chapter-position-stability',
      mutate(observation) {
        observation.positions.chapterShared = [{
          id: 'other',
          bounds: { x: 10, y: 10, width: 20, height: 20 },
        }];
      },
      reason: 'no-common-entity',
    },
    {
      name: 'snapshot entity lost',
      check: 'overview-chapter-position-stability',
      mutate(observation) {
        observation.positions.chapterShared = observation.positions.chapterShared.slice(0, 1);
      },
      reason: 'entity-missing-after',
    },
  ];

  for (const item of adversarial) {
    const observation = structuredClone(compliant);
    item.mutate(observation);
    const evaluation = await evaluateNarrativeEquity({
      observation,
      runId: `adversarial-${item.name}`,
      allowTestDouble: true,
    });
    const check = evaluation.bundle.results.find(result => result.check_id === item.check);
    assert.equal(check.status, 'fail', `${item.name} must fail ${item.check}`);
    assert.ok(
      check.evidence.details.failures.some(failure => failure.reason === item.reason),
      `${item.name} must report ${item.reason}`,
    );
  }
});

for (const entry of tests) {
  try {
    await entry.fn();
    process.stdout.write(`PASS ${entry.name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${entry.name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) process.stdout.write(`Narrative equity evaluator: ${tests.length}/${tests.length} tests passed.\n`);

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(HERE, relativePath), 'utf8'));
}

function merge(base, override) {
  if (Array.isArray(override)) return structuredClone(override);
  if (!override || typeof override !== 'object') return override;
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base?.[key] || {}, value)
      : structuredClone(value);
  }
  return output;
}

function asTestDouble(observation) {
  const output = structuredClone(observation);
  output.provenance = {
    boolean_facts: Object.fromEntries(collectBooleanPaths(output).map(path => [
      path,
      [{ source: 'test_double', conclusion_eligible: false }],
    ])),
  };
  return output;
}

function asProductionObservation(observation, digests) {
  const output = structuredClone(observation);
  output.provenance = {
    boolean_facts: Object.fromEntries(collectBooleanPaths(output).map(path => {
      const source = path.startsWith('/commands/')
        ? 'command'
        : path.startsWith('/dsl/')
          ? 'hidden_control'
          : 'browser_state';
      const binding = source === 'command'
        ? 'command_evidence'
        : source === 'hidden_control'
          ? 'hidden_control_execution'
          : 'browser_evidence';
      const locator = path;
      return [path, [{
        source,
        binding,
        locator,
        sha256: digests[binding],
      }]];
    })),
  };
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
