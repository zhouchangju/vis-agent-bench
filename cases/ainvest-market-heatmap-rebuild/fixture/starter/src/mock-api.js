import { getFixtureCatalog } from './fixture-data.js';

const DEFAULT_QUERY = Object.freeze({
  market: 'stock',
  data_source: 'sp500',
  area_metric: 'market_cap',
  color_metric: 'daily_change_pct',
  group_by: 'sector',
  include_btc: true,
  search: '',
  scenario: 'success',
  request_id: 'fixture-request-000',
  delay_ms: 0,
});

const ALLOWED = {
  market: new Set(['stock', 'etf', 'crypto']),
  data_source: new Set(['sp500', 'nasdaq100', 'nasdaq-composite', 'nyse', 'all-stocks', 'dow-jones']),
  area_metric: new Set(['market_cap', 'equal', 'aum']),
  color_metric: new Set(['daily_change_pct', 'weekly_change_pct', 'volume_delta_pct']),
  group_by: new Set(['sector', 'asset_class', 'none']),
  scenario: new Set(['success', 'empty', 'error']),
};

export async function requestMarketData(input = {}) {
  const query = { ...DEFAULT_QUERY, ...input };
  const issue = validateQuery(query);
  if (issue) return errorResponse(query, 'INVALID_QUERY', issue);
  if (query.delay_ms > 0) await delay(query.delay_ms);
  if (query.scenario === 'error') {
    return errorResponse(query, 'SYNTHETIC_UPSTREAM_FAILURE', 'The requested control scenario simulates a recoverable upstream failure.');
  }

  const catalog = getFixtureCatalog();
  let nodes = query.scenario === 'empty'
    ? []
    : catalog.nodes.filter(node => node.market === query.market);

  if (query.market === 'stock') {
    nodes = nodes.filter(node => node.scope_ids.includes(query.data_source));
  }
  if (query.market === 'crypto' && !query.include_btc) {
    nodes = nodes.filter(node => !node.is_btc);
  }
  const search = query.search.trim().toLocaleLowerCase('en');
  if (search) {
    nodes = nodes.filter(node => `${node.symbol} ${node.name}`.toLocaleLowerCase('en').includes(search));
  }

  const parentIds = new Set(nodes.map(node => node.parent_id));
  const groups = query.group_by === 'none'
    ? []
    : catalog.groups.filter(group => group.market === query.market && parentIds.has(group.id));
  const nullAreaCount = nodes.filter(node => query.area_metric !== 'equal' && node[query.area_metric] == null).length;
  const nullColorCount = nodes.filter(node => node[query.color_metric] == null).length;

  return {
    status: nodes.length ? (nullAreaCount || nullColorCount ? 'warning' : 'success') : 'success',
    summary: nodes.length
      ? `Synthetic response contains ${nodes.length} nodes and ${groups.length} groups.`
      : 'Synthetic response is empty for the requested scenario.',
    next_actions: [
      ...(nullAreaCount ? [`Apply a documented fallback for ${nullAreaCount} null area value(s).`] : []),
      ...(nullColorCount ? [`Render ${nullColorCount} null color value(s) with an explicit no-data treatment.`] : []),
    ],
    artifacts: ['src/fixture-data.js'],
    request_id: String(query.request_id),
    data: { groups, nodes },
    meta: {
      query: {
        market: query.market,
        data_source: query.data_source,
        area_metric: query.area_metric,
        color_metric: query.color_metric,
        group_by: query.group_by,
        include_btc: query.include_btc,
        search: query.search,
      },
      color_domain: {
        soft_min: query.market === 'crypto' ? -15 : -8,
        neutral: 0,
        soft_max: query.market === 'crypto' ? 15 : 8,
        clamp: true,
      },
      generated_at: catalog.generated_at,
    },
  };
}

function validateQuery(query) {
  for (const [field, values] of Object.entries(ALLOWED)) {
    if (!values.has(query[field])) return `Unsupported ${field}: ${String(query[field])}.`;
  }
  if (!Number.isInteger(query.delay_ms) || query.delay_ms < 0 || query.delay_ms > 2_000) {
    return 'delay_ms must be an integer between 0 and 2000.';
  }
  if (typeof query.include_btc !== 'boolean') return 'include_btc must be boolean.';
  if (typeof query.search !== 'string' || query.search.length > 100) return 'search must be a string of at most 100 characters.';
  if (query.market === 'etf' && !['aum', 'equal'].includes(query.area_metric)) return 'ETF area_metric must be aum or equal.';
  if (query.market !== 'etf' && query.area_metric === 'aum') return 'AUM is only available for ETF.';
  if (query.market === 'stock' && !['sector', 'none'].includes(query.group_by)) return 'Stock group_by must be sector or none.';
  if (query.market === 'etf' && !['asset_class', 'none'].includes(query.group_by)) return 'ETF group_by must be asset_class or none.';
  if (query.market === 'crypto' && query.group_by !== 'none') return 'Crypto group_by must be none.';
  return null;
}

function errorResponse(query, code, hint) {
  return {
    status: 'error',
    summary: `Synthetic Mock API rejected request ${String(query.request_id)}.`,
    next_actions: ['Correct the query or retry the recoverable error scenario with scenario=success.'],
    artifacts: ['src/contracts.d.ts'],
    request_id: String(query.request_id),
    data: { groups: [], nodes: [] },
    meta: {
      query: {
        market: query.market,
        area_metric: query.area_metric,
        color_metric: query.color_metric,
        group_by: query.group_by,
      },
      color_domain: { soft_min: -8, neutral: 0, soft_max: 8, clamp: true },
      generated_at: '2026-01-15T14:30:00.000Z',
    },
    error: {
      code,
      root_cause_hint: hint,
      safe_retry: 'Fix the reported query issue, then retry with a new request_id.',
      stop_condition: 'Stop after two identical failures and surface the error state to the user.',
    },
  };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
