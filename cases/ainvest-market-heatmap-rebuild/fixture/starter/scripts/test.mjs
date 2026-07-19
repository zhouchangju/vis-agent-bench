import assert from 'node:assert/strict';
import { getFixtureCatalog } from '../src/fixture-data.js';
import { requestMarketData } from '../src/mock-api.js';

const catalog = getFixtureCatalog();
assert.equal(catalog.schema_version, 1);
assert.ok(catalog.nodes.length >= 90, 'fixture must be dense enough to exercise label degradation');
assert.deepEqual(new Set(catalog.nodes.map(node => node.market)), new Set(['stock', 'etf', 'crypto']));
assert.ok(catalog.nodes.every(node => !('x' in node) && !('y' in node) && !('width' in node) && !('height' in node)));

for (const scope of catalog.capabilities.stock_scopes) {
  const response = await requestMarketData({ market: 'stock', data_source: scope, request_id: `scope-${scope}` });
  assert.notEqual(response.status, 'error');
  assert.ok(response.data.nodes.length > 0, `${scope} must have data`);
}

const stock = await requestMarketData({ market: 'stock', data_source: 'all-stocks', request_id: 'stock-boundaries' });
const tags = new Set(stock.data.nodes.flatMap(node => node.boundary_tags));
for (const tag of ['null-area', 'minimum-area', 'dominant-area', 'null-color', 'zero-color', 'positive-extreme', 'negative-extreme', 'long-label', 'dense-label']) {
  assert.ok(tags.has(tag), `missing boundary tag: ${tag}`);
}

const withBtc = await requestMarketData({ market: 'crypto', group_by: 'none', request_id: 'crypto-with' });
const withoutBtc = await requestMarketData({ market: 'crypto', group_by: 'none', include_btc: false, request_id: 'crypto-without' });
assert.equal(withBtc.data.nodes.length, withoutBtc.data.nodes.length + 1);
assert.equal(withoutBtc.data.nodes.some(node => node.is_btc), false);

const empty = await requestMarketData({ scenario: 'empty', request_id: 'empty' });
assert.deepEqual(empty.data.nodes, []);
const failed = await requestMarketData({ scenario: 'error', request_id: 'failed' });
assert.equal(failed.status, 'error');
assert.equal(typeof failed.error.safe_retry, 'string');
const invalid = await requestMarketData({ market: 'etf', area_metric: 'market_cap', group_by: 'asset_class', request_id: 'invalid' });
assert.equal(invalid.error.code, 'INVALID_QUERY');

console.log(JSON.stringify({
  status: 'success',
  summary: `${catalog.nodes.length} synthetic nodes and all Mock API state contracts passed.`,
  next_actions: [],
  artifacts: ['src/fixture-data.js', 'src/mock-api.js'],
}));
