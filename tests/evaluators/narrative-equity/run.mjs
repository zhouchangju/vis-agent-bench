import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

const HERE = dirname(fileURLToPath(import.meta.url));
const compliant = readJson('samples/minimal-compliant.json');
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
  const evaluation = await evaluateNarrativeEquity({ observation: structuredClone(compliant), runId: 'minimal-pass' });
  assert.equal(evaluation.status, 'success');
  assert.equal(evaluation.scorecard.total, 100);
  assert.equal(evaluation.bundle.results.length, 39);
  assert.deepEqual([...new Set(evaluation.bundle.results.map(item => item.status))], ['pass']);
});

test('intentionally wrong sample fails build, overlap, navigation, and cleanup gates', async () => {
  const evaluation = await evaluateNarrativeEquity({ observation: faulty, runId: 'intentional-failure' });
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
