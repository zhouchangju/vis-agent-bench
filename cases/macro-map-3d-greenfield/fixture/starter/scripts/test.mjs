import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGraphData } from '../src/data-contract.js';
import {
  assertSceneAdapter,
  createUnimplementedAdapter,
  SCENE_INPUT_CONTRACT,
  validateRuntimeOptions,
} from '../src/scene-adapter.js';

const root = resolve(import.meta.dirname, '..');
const expected = new Map([[200, 284], [800, 1137], [1481, 2106]]);
for (const [nodes, relations] of expected) {
  const graph = JSON.parse(readFileSync(resolve(root, `data/public/graph-${nodes}.json`), 'utf8'));
  const result = validateGraphData(graph);
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.equal(graph.nodes.length, nodes);
  assert.equal(graph.relations.length, relations);
}
const boundary = JSON.parse(readFileSync(resolve(root, 'data/public/boundary-valid.json'), 'utf8'));
assert.equal(validateGraphData(boundary).status, 'success');
assert.ok(boundary.nodes.some((node) => node.labels.en.length > 80));
assert.ok(boundary.nodes.some((node) => node.importance < 0));
assert.ok(boundary.nodes.some((node) => node.importance > 1));
assert.equal(assertSceneAdapter(createUnimplementedAdapter()).dispose().status, 'warning');
assert.deepEqual(SCENE_INPUT_CONTRACT.viewModes, ['sphere-3d', 'relation-2d']);
assert.equal(validateRuntimeOptions({
  theme: 'light',
  language: 'zh',
  viewMode: 'sphere-3d',
  relationStrategy: 'interaction-only',
  visibleOffset: { top: 0, right: 320, bottom: 0, left: 0 },
}).status, 'success');

console.log(JSON.stringify({
  status: 'success',
  summary: 'Public data and starter adapter contract checks passed.',
  next_actions: [],
  artifacts: ['data/public/graph-200.json', 'data/public/graph-800.json', 'data/public/graph-1481.json'],
}));
