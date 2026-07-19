#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGraphData } from '../../../cases/macro-map-3d-greenfield/fixture/starter/src/data-contract.js';

const root = resolve(import.meta.dirname, '../../..');
const fixture = resolve(root, 'cases/macro-map-3d-greenfield/fixture');
const publicData = resolve(fixture, 'starter/data/public');
const expected = new Map([[200, 284], [800, 1137], [1481, 2106]]);

for (const [nodeCount, relationCount] of expected) {
  const graph = JSON.parse(readFileSync(resolve(publicData, `graph-${nodeCount}.json`), 'utf8'));
  const validation = validateGraphData(graph);
  assert.equal(validation.status, 'success', JSON.stringify(validation));
  assert.equal(graph.nodes.length, nodeCount);
  assert.equal(graph.relations.length, relationCount);
  assert.deepEqual(new Set(graph.nodes.map((node) => node.layer)), new Set(['core', 'peripheral']));
  assert.deepEqual(new Set(graph.relations.map((edge) => edge.type)), new Set(['positive', 'negative', 'unknown']));
  assert.ok(graph.relations.some((edge) => edge.primary));
  assert.ok(graph.meta.metrics.length >= 3 && graph.meta.periods.length >= 4);
}

const full = JSON.parse(readFileSync(resolve(publicData, 'graph-1481.json'), 'utf8'));
const degree = new Map(full.nodes.map((node) => [node.id, 0]));
for (const relation of full.relations) {
  degree.set(relation.source, degree.get(relation.source) + 1);
  degree.set(relation.target, degree.get(relation.target) + 1);
}
assert.ok(Math.max(...degree.values()) >= 300, 'high-density hub is required');
assert.ok(full.nodes.some((node) => node.labels.en.length > 80), 'long English label required');
assert.ok(full.nodes.some((node) => node.labels.zh.length > 20), 'long Chinese label required');
assert.ok(existsSync(resolve(fixture, 'control/invalid-inputs.json')));
assert.ok(existsSync(resolve(fixture, 'starter/public/assets/generated-grid.svg')));

console.log(JSON.stringify({
  status: 'success',
  summary: 'Macro Map synthetic fixture contract verified.',
  next_actions: [],
  artifacts: [publicData, resolve(fixture, 'control/invalid-inputs.json')],
}));
