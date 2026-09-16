import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AREA_SHARE_TOLERANCE,
  COLOR_POSITION_TOLERANCE,
  businessStatesEqual,
  evaluateAinvestHeatmap,
  expectedColorPosition,
  validateCheckMapping,
} from '../../../src/evaluators/cases/ainvest-heatmap/index.mjs';
import { loadAinvestHeatmapRubric } from '../../../src/evaluators/cases/ainvest-heatmap/rubric.mjs';
import { collectBooleanPaths } from '../../../src/evaluators/control/observation-attestation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const compliantSource = readJson('samples/minimal-compliant.json');
const compliant = asTestDouble(compliantSource);
const failureOverlay = readJson('samples/intentional-failure.json');
const faulty = asTestDouble(merge(compliantSource, failureOverlay.overrides));
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('rubric IDs, assertions, and hard gates are one-to-one', () => {
  const mapping = validateCheckMapping(loadAinvestHeatmapRubric());
  assert.equal(mapping.declared.length, 24);
  assert.equal(mapping.registered.length, 24);
  assert.equal(mapping.hardGates.length, 8);
  assert.deepEqual(mapping.declared, mapping.registered);
  assert.ok(mapping.hardGates.every(id => mapping.declared.includes(id)));
});

test('area and color tolerances have explicit deterministic boundaries', () => {
  assert.equal(AREA_SHARE_TOLERANCE, 0.02);
  assert.equal(COLOR_POSITION_TOLERANCE, 0.001);
  assert.equal(expectedColorPosition(-20, { softMin: -8, neutral: 0, softMax: 8, clamp: true }), 0);
  assert.equal(expectedColorPosition(0, { softMin: -8, neutral: 0, softMax: 8, clamp: true }), 0.5);
  assert.equal(expectedColorPosition(20, { softMin: -8, neutral: 0, softMax: 8, clamp: true }), 1);
  assert.equal(expectedColorPosition(null, { softMin: -8, neutral: 0, softMax: 8, clamp: true }), null);
});

test('business state comparison ignores ordering but not filter or drill changes', () => {
  assert.equal(businessStatesEqual(
    { market: 'stock', drillPath: ['sector-a'], visibleIds: ['a', 'b'] },
    { visibleIds: ['b', 'a'], drillPath: ['sector-a'], market: 'stock' },
  ), true);
  assert.equal(businessStatesEqual(
    { market: 'stock', drillPath: ['sector-a'] },
    { market: 'stock', drillPath: [] },
  ), false);
});

test('minimum compliant sample passes every deterministic rubric check', async () => {
  const evaluation = await evaluateAinvestHeatmap({
    observation: structuredClone(compliant),
    runId: 'heatmap-minimal-pass',
    allowTestDouble: true,
  });
  assert.equal(evaluation.status, 'success');
  assert.equal(evaluation.scorecard.total, 100);
  assert.equal(evaluation.bundle.results.length, 24);
  assert.deepEqual([...new Set(evaluation.bundle.results.map(item => item.status))], ['pass']);
  assert.ok(evaluation.bundle.results.every(item => (
    item.evidence.proof_boundary.includes('aesthetics are not machine-proven')
  )));
  assert.equal(evaluation.bundle.evidence_trust.conclusion_eligible, false);
});

test('intentionally wrong sample fails each targeted deterministic contract', async () => {
  const evaluation = await evaluateAinvestHeatmap({
    observation: faulty,
    runId: 'heatmap-intentional-failure',
    allowTestDouble: true,
  });
  const failed = new Set(
    evaluation.bundle.results.filter(item => item.status === 'fail').map(item => item.check_id),
  );
  for (const id of [
    'build-and-test',
    'area-weight-fidelity',
    'color-scale-semantics',
    'legend-scale-contract',
    'hierarchy-drill-and-back',
    'search-and-filter',
    'filter-state-restoration',
    'resize-state-preservation',
    'keyboard-accessibility',
  ]) {
    assert.ok(failed.has(id), `${id} should fail`);
  }
  assert.equal(evaluation.status, 'error');
  assert.equal(evaluation.scorecard.total, 0);
  assert.ok(evaluation.scorecard.hard_gates.failing.length >= 5);
  const area = evaluation.bundle.results.find(item => item.check_id === 'area-weight-fidelity');
  assert.ok(area.evidence.details.failures.some(item => item.error > AREA_SHARE_TOLERANCE));
  const color = evaluation.bundle.results.find(item => item.check_id === 'color-scale-semantics');
  assert.ok(color.evidence.details.failures.length >= 5);
});

test('missing commands section is rejected instead of guessed as passing', async () => {
  await assert.rejects(
    () => evaluateAinvestHeatmap({
      observation: asTestDouble({}),
      allowTestDouble: true,
    }),
    /observation is missing "commands"/,
  );
});

test('conservative real-run observation (commands only) runs with every case check unproven', async () => {
  // Real CLI runs carry only the collector's conservative observation; the
  // evaluator must accept it but prove nothing about case-specific sections.
  const evaluation = await evaluateAinvestHeatmap({
    observation: asTestDouble({ commands: {} }),
    allowTestDouble: true,
  });
  assert.equal(evaluation.status, 'error');
  const passed = evaluation.bundle.results.filter(item => item.status === 'pass');
  assert.deepEqual(passed, [], `no check may pass on absent evidence: ${JSON.stringify(passed)}`);
});

test('production mode rejects bare observation and arbitrary observationPath', async () => {
  await assert.rejects(
    () => evaluateAinvestHeatmap({ observation: compliant, runId: 'bare' }),
    /reject bare observation/,
  );
  await assert.rejects(
    () => evaluateAinvestHeatmap({ observationPath: '/tmp/arbitrary.json', runId: 'bare-path' }),
    /reject bare observation/,
  );
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

if (!process.exitCode) {
  process.stdout.write(`AInvest Heatmap evaluator: ${tests.length}/${tests.length} tests passed.\n`);
}

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
