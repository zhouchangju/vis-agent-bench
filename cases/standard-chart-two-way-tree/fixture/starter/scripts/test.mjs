import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadIndustryChain, listNeighbours, TWO_WAY_DIRECTIONS } from '../src/data-loader.js';

const root = resolve(import.meta.dirname, '..');
const raw = JSON.parse(readFileSync(resolve(root, 'public/assets/sample-data.json'), 'utf8'));

const chain = loadIndustryChain();
assert.equal(chain.schema_version, 1);
assert.equal(chain.root_id, raw.root_id);
assert.ok(chain.nodes.length >= 10, 'fixture must contain at least 10 synthetic nodes');
assert.ok(chain.edges.length >= 10, 'fixture must contain at least 10 synthetic edges');

// Root node must be present.
const rootNodes = chain.nodes.filter(node => node.id === chain.root_id);
assert.equal(rootNodes.length, 1, 'root_id must resolve to exactly one node');

// Every edge endpoint must exist as a node.
const ids = new Set(chain.nodes.map(node => node.id));
for (const edge of chain.edges) {
  assert.ok(ids.has(edge.from), `edge.from ${edge.from} must reference a known node`);
  assert.ok(ids.has(edge.to), `edge.to ${edge.to} must reference a known node`);
  assert.ok(TWO_WAY_DIRECTIONS.includes(edge.direction), `edge.direction ${edge.direction} must be upstream or downstream`);
}

// Boundary tags expected by the rubric must be present.
const changeValues = chain.nodes.map(node => node.changePct);
assert.ok(changeValues.some(value => value == null), 'fixture must include a null changePct boundary');
assert.ok(changeValues.some(value => value === 0), 'fixture must include a zero changePct boundary');
assert.ok(changeValues.some(value => value >= 30), 'fixture must include an extreme positive boundary');
assert.ok(changeValues.some(value => value <= -30), 'fixture must include an extreme negative boundary');
assert.ok(chain.nodes.some(node => node.name.length > 40), 'fixture must include a long-label boundary');
assert.ok(chain.nodes.some(node => node.name === rootNodes[0].name && node.id !== chain.root_id), 'fixture must include a duplicate-name boundary');

// The synthetic chain must have at least one upstream neighbour and one downstream neighbour of the root.
const upstream = listNeighbours(chain, chain.root_id, 'upstream');
const downstream = listNeighbours(chain, chain.root_id, 'downstream');
assert.ok(upstream.length > 0, 'root must have at least one declared upstream neighbour');
assert.ok(downstream.length > 0, 'root must have at least one declared downstream neighbour');

console.log(JSON.stringify({
  status: 'success',
  summary: `${chain.nodes.length} synthetic nodes and ${chain.edges.length} edges passed the starter contract.`,
  next_actions: [],
  artifacts: ['public/assets/sample-data.json'],
}));
