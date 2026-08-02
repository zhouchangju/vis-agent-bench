import assert from 'node:assert/strict';

import {
  FOCUS_DRIFT_TOLERANCE,
  LARGE_TREE_NODE_BUDGET,
  bidirectionalReachable,
  canonicalTreeState,
  evaluateStandardChartTwoWayTree,
  overlapFailures,
  treeStatesEqual,
  validateCheckMapping,
} from '../../../src/evaluators/cases/standard-chart-two-way-tree/index.mjs';
import { loadStandardChartRubric } from '../../../src/evaluators/cases/standard-chart-two-way-tree/rubric.mjs';
import { collectBooleanPaths } from '../../../src/evaluators/control/observation-attestation.mjs';
import {
  createIntentionalFailure,
  createMinimalCompliantObservation,
} from './samples.mjs';

const compliantSource = createMinimalCompliantObservation();
const compliant = asTestDouble(compliantSource);
const failureOverlay = createIntentionalFailure();
const faulty = asTestDouble(merge(compliantSource, failureOverlay.overrides));

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('rubric IDs, assertions, and hard gates are one-to-one', () => {
  const mapping = validateCheckMapping(loadStandardChartRubric());
  assert.equal(mapping.declared.length, 24);
  assert.equal(mapping.registered.length, 24);
  assert.equal(mapping.hardGates.length, 8);
  assert.deepEqual(mapping.declared, mapping.registered);
  assert.ok(mapping.hardGates.every(id => mapping.declared.includes(id)));
});

test('deterministic math helpers reject asymmetric and overlapping inputs', () => {
  const reachable = bidirectionalReachable(compliantSource.tree_structure.declaredEdges, 'n0');
  assert.deepEqual(reachable.upstream.sort(), ['n1', 'n2', 'n3']);
  assert.deepEqual(reachable.downstream.sort(), ['n4', 'n5', 'n6']);

  // A focus with no upstream/downstream edges yields empty reachable sets.
  const empty = bidirectionalReachable([], 'n0');
  assert.deepEqual(empty.upstream, []);
  assert.deepEqual(empty.downstream, []);

  const overlaps = overlapFailures([
    { id: 'a', direction: 'upstream', x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', direction: 'upstream', x: 5, y: 5, width: 10, height: 10 },
  ]);
  assert.equal(overlaps.length, 1);

  // Non-overlapping boxes in different directions don't flag each other.
  const clean = overlapFailures([
    { id: 'a', direction: 'upstream', x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', direction: 'downstream', x: 5, y: 5, width: 10, height: 10 },
  ]);
  assert.equal(clean.length, 0);
});

test('tree state comparison ignores visible-id ordering but catches selection changes', () => {
  assert.equal(treeStatesEqual(
    { focusId: 'n0', selectedId: 'n2', visibleIds: ['a', 'b'] },
    { visibleIds: ['b', 'a'], selectedId: 'n2', focusId: 'n0' },
  ), true);
  assert.equal(treeStatesEqual(
    { focusId: 'n0', selectedId: 'n2' },
    { focusId: 'n0', selectedId: null },
  ), false);
  assert.deepEqual(
    canonicalTreeState({ focusId: 'n0', selectedId: undefined }),
    { focusId: 'n0' },
  );
});

test('minimum compliant sample passes every deterministic rubric check', async () => {
  const evaluation = await evaluateStandardChartTwoWayTree({
    observation: structuredClone(compliant),
    runId: 'two-way-tree-minimal-pass',
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
  const evaluation = await evaluateStandardChartTwoWayTree({
    observation: faulty,
    runId: 'two-way-tree-intentional-failure',
    allowTestDouble: true,
  });
  const failed = new Set(
    evaluation.bundle.results.filter(item => item.status === 'fail').map(item => item.check_id),
  );
  for (const id of [
    'build-and-test',
    'bidirectional-tree-expansion',
    'symmetric-traversal',
    'deep-tree-render',
    'duplicate-and-boundary-nodes',
    'upstream-and-downstream-direction',
    'path-highlight-on-select',
    'parent-child-edge-fidelity',
    'selection-and-toggle',
    'blank-click-deselect',
    'event-contract',
    'expand-collapse-stability',
    'data-driven-layout',
    'no-edge-node-overlap',
    'long-label-degradation',
    'large-tree-interaction-budget',
    'lifecycle-cleanup',
    'keyboard-accessibility',
    'theme-and-group-style',
    'implementation-notes',
  ]) {
    assert.ok(failed.has(id), `${id} should fail`);
  }
  assert.equal(evaluation.status, 'error');
  assert.equal(evaluation.scorecard.total, 0);
  assert.ok(evaluation.scorecard.hard_gates.failing.length >= 5);

  const layout = evaluation.bundle.results.find(item => item.check_id === 'expand-collapse-stability');
  assert.ok(layout.evidence.details.focusCentroidDrift > FOCUS_DRIFT_TOLERANCE);
  const perf = evaluation.bundle.results.find(item => item.check_id === 'large-tree-interaction-budget');
  assert.ok(perf.evidence.details.fps < 20);
  assert.equal(perf.evidence.details.nodeCount, LARGE_TREE_NODE_BUDGET + 20);
});

test('missing observation sections are rejected instead of guessed as passing', async () => {
  await assert.rejects(
    () => evaluateStandardChartTwoWayTree({
      observation: asTestDouble({ commands: {} }),
      allowTestDouble: true,
    }),
    /observation is missing "input"/,
  );
});

test('production mode rejects bare observation and arbitrary observationPath', async () => {
  await assert.rejects(
    () => evaluateStandardChartTwoWayTree({ observation: compliant, runId: 'bare' }),
    /reject bare observation/,
  );
  await assert.rejects(
    () => evaluateStandardChartTwoWayTree({ observationPath: '/tmp/arbitrary.json', runId: 'bare-path' }),
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
  process.stdout.write(`StandardChart two-way-tree evaluator: ${tests.length}/${tests.length} tests passed.\n`);
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
