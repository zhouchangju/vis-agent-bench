import { requestMarketData } from './mock-api.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="starter-header">
    <div>
      <p class="eyebrow">Synthetic fixture</p>
      <h1>Market Map implementation surface</h1>
      <p>Replace the placeholder with a data-driven implementation. No layout answer is included.</p>
    </div>
    <output id="request-status" role="status">Loading synthetic data…</output>
  </header>
  <section class="controls" aria-label="Starter controls">
    <label>Market
      <select id="market">
        <option value="stock">Stock</option>
        <option value="etf">ETF</option>
        <option value="crypto">Crypto</option>
      </select>
    </label>
    <label>Search
      <input id="search" type="search" placeholder="Symbol or synthetic name">
    </label>
    <button id="reload" type="button">Reload</button>
  </section>
  <section id="market-map-root" class="implementation-surface" aria-label="Market map implementation surface">
    <div class="placeholder">
      <strong>Treemap intentionally absent</strong>
      <span id="data-summary">Waiting for Mock API response.</span>
    </div>
  </section>
`;

const market = document.querySelector('#market');
const search = document.querySelector('#search');
const status = document.querySelector('#request-status');
const summary = document.querySelector('#data-summary');

async function load() {
  app.setAttribute('aria-busy', 'true');
  status.textContent = 'Loading synthetic data…';
  const marketValue = market.value;
  const response = await requestMarketData({
    market: marketValue,
    data_source: 'all-stocks',
    area_metric: marketValue === 'etf' ? 'aum' : 'market_cap',
    group_by: marketValue === 'stock' ? 'sector' : marketValue === 'etf' ? 'asset_class' : 'none',
    search: search.value,
    request_id: `starter-${marketValue}`,
  });
  status.textContent = `${response.status}: ${response.summary}`;
  summary.textContent = `${response.data.nodes.length} nodes available. Mount the implementation at #market-map-root.`;
  app.setAttribute('aria-busy', 'false');
  window.__MARKET_FIXTURE_RESPONSE__ = response;
}

document.querySelector('#reload').addEventListener('click', load);
market.addEventListener('change', load);
load();
