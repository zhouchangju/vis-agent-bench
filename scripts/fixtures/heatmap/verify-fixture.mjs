#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getFixtureCatalog } from '../../../cases/ainvest-market-heatmap-rebuild/fixture/starter/src/fixture-data.js';

const root = resolve(import.meta.dirname, '../../..');
const fixture = resolve(root, 'cases/ainvest-market-heatmap-rebuild/fixture');
const starter = resolve(fixture, 'starter');
const control = resolve(fixture, 'control/invalid-input.json');
const catalogA = getFixtureCatalog();
const catalogB = getFixtureCatalog();

assert.equal(hash(catalogA), hash(catalogB), 'catalog generation must be deterministic');
assert.ok(existsSync(control), 'control-only invalid input must exist outside starter');
assert.ok(catalogA.nodes.length >= 90, 'catalog must exercise high-density labels');
assert.equal(new Set(catalogA.nodes.map(node => node.id)).size, catalogA.nodes.length, 'node ids must be unique');
assert.ok(catalogA.nodes.every(node => catalogA.groups.some(group => group.id === node.parent_id)), 'every node parent must exist');
assert.ok(catalogA.nodes.every(node => node.market_cap == null || node.market_cap >= 0));
assert.ok(catalogA.nodes.every(node => node.aum == null || node.aum >= 0));
assert.ok(catalogA.nodes.every(node => node.daily_change_pct == null || Number.isFinite(node.daily_change_pct)));

const stockScopes = new Set(catalogA.nodes.filter(node => node.market === 'stock').flatMap(node => node.scope_ids));
assert.deepEqual(stockScopes, new Set(['sp500', 'nasdaq100', 'nasdaq-composite', 'nyse', 'all-stocks', 'dow-jones']));
assert.ok(catalogA.nodes.some(node => node.is_btc), 'crypto fixture must have one BTC-toggle target');
assert.equal(catalogA.nodes.filter(node => node.is_btc).length, 1);

const forbiddenLayoutFields = ['x', 'y', 'x0', 'x1', 'y0', 'y1', 'width', 'height', 'rect', 'coordinates'];
assert.ok(catalogA.nodes.every(node => forbiddenLayoutFields.every(field => !(field in node))), 'fixture must not encode layout answers');

const invalid = JSON.parse(readFileSync(control, 'utf8'));
assert.ok(invalid.cases.length >= 4, 'negative tests require multiple invalid families');
assert.ok(invalid.cases.some(entry => entry.id === 'negative-area'));
assert.ok(invalid.cases.some(entry => entry.id === 'unknown-market'));

console.log(JSON.stringify({
  status: 'success',
  summary: `Synthetic fixture contract verified for ${catalogA.nodes.length} nodes.`,
  next_actions: [],
  artifacts: [starter, control],
  catalog_sha256: hash(catalogA),
}));

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
