const GENERATED_AT = '2026-01-15T14:30:00.000Z';

const GROUPS = [
  ['sector-compute', 'Compute Systems', 'stock'],
  ['sector-health', 'Health Research', 'stock'],
  ['sector-industrial', 'Industrial Motion', 'stock'],
  ['sector-consumer', 'Consumer Networks', 'stock'],
  ['sector-finance', 'Financial Platforms', 'stock'],
  ['sector-energy', 'Energy Transition', 'stock'],
  ['class-broad', 'Broad Allocation', 'etf'],
  ['class-income', 'Income Strategies', 'etf'],
  ['class-thematic', 'Thematic Strategies', 'etf'],
  ['class-digital', 'Synthetic Digital Assets', 'crypto'],
].map(([id, name, market], order) => ({ id, name, market, order }));

const STOCK_SEEDS = [
  ['ALP', 'Alpine Compute Cooperative', 'sector-compute', 3_400_000_000_000, 5.4, 188.2, 92_000_000],
  ['BRK', 'Borealis Kernel Works', 'sector-compute', 1_280_000_000_000, -2.3, 97.1, 41_000_000],
  ['CYM', 'Cymbal Cloud Instruments', 'sector-compute', 420_000_000_000, 0, 54.7, 18_000_000],
  ['DVL', 'Deep Valley Logic and Memory', 'sector-compute', 96_000_000_000, null, 31.8, 7_000_000],
  ['EON', 'Eon Clinical Discovery', 'sector-health', 860_000_000_000, 3.1, 142.4, 29_000_000],
  ['FLR', 'Flora Therapeutic Research', 'sector-health', 310_000_000_000, -4.8, 73.5, 12_000_000],
  ['GLM', 'Glimmer Diagnostic Devices', 'sector-health', 78_000_000_000, 0.04, 28.6, 4_600_000],
  ['HBR', 'Harbor Mobility Fabrication', 'sector-industrial', 690_000_000_000, -1.1, 116.9, 16_000_000],
  ['ION', 'Ion Railway Automation', 'sector-industrial', 205_000_000_000, 2.8, 66.3, 8_100_000],
  ['JCT', 'Junction Precision and Logistics', 'sector-industrial', 44_000_000_000, -0.02, 22.9, 2_100_000],
  ['KIO', 'Kiosk Neighborhood Markets', 'sector-consumer', 570_000_000_000, 1.9, 104.6, 21_000_000],
  ['LUM', 'Lumen Household Exchange', 'sector-consumer', 188_000_000_000, -3.7, 48.4, 9_600_000],
  ['MNT', 'Mint Orchard Retail Network', 'sector-consumer', 38_000_000_000, 7.6, 18.2, 3_400_000],
  ['NMB', 'Nimbus Settlement Systems', 'sector-finance', 930_000_000_000, -0.8, 151.3, 25_000_000],
  ['OPL', 'Opal Cooperative Banking', 'sector-finance', 260_000_000_000, 1.2, 61.7, 11_000_000],
  ['PRM', 'Prism Risk Exchange', 'sector-finance', 52_000_000_000, -6.2, 24.1, 5_200_000],
  ['QNT', 'Quanta Renewable Grid', 'sector-energy', 740_000_000_000, 4.4, 128.5, 20_000_000],
  ['RIV', 'River Battery Materials', 'sector-energy', 225_000_000_000, -5.5, 57.9, 13_000_000],
  ['SOL', 'Solstice Thermal Storage', 'sector-energy', 46_000_000_000, 0.6, 20.7, 2_700_000],
  ['TNY', 'Tiny Boundary Laboratories', 'sector-health', 1, 41.7, 0.01, 1],
  ['VOD', 'Void Volume Holdings', 'sector-finance', 9_500_000, -33.4, 2.2, 0],
  ['WDE', 'Wide Label Experimental Manufacturing Consortium', 'sector-industrial', 14_000_000, 18.9, null, null],
  ['ZER', 'Zero Motion Public Company', 'sector-consumer', 12_000_000, 0, 1.5, 450],
  ['NUL', 'Null Change Observatory', 'sector-energy', null, null, 3.4, 780]
];

const STOCK_SCOPES = ['sp500', 'nasdaq100', 'nasdaq-composite', 'nyse', 'all-stocks', 'dow-jones'];

function stockScopes(index) {
  const scopes = new Set(['all-stocks', STOCK_SCOPES[index % STOCK_SCOPES.length]]);
  if (index % 2 === 0) scopes.add('sp500');
  if (index % 3 === 0) scopes.add('nasdaq-composite');
  if (index % 5 === 0) scopes.add('nyse');
  return [...scopes];
}

function makeStocks() {
  const base = STOCK_SEEDS.map((seed, index) => {
    const [symbol, name, parentId, marketCap, change, price, volume] = seed;
    return makeNode({
      id: `stock-${symbol.toLowerCase()}`,
      parent_id: parentId,
      market: 'stock',
      symbol,
      name,
      price,
      market_cap: marketCap,
      aum: null,
      volume,
      daily_change_pct: change,
      weekly_change_pct: change == null ? null : round(change * 1.65 - (index % 4)),
      volume_delta_pct: volume == null ? null : round(((index % 9) - 4) * 7.25),
      scope_ids: stockScopes(index),
      boundary_tags: boundaryTags({ marketCap, change, price, volume, name }),
    });
  });

  const sectors = GROUPS.filter(group => group.market === 'stock');
  const dense = Array.from({ length: 48 }, (_, index) => {
    const ordinal = index + 1;
    const parent = sectors[index % sectors.length];
    const change = round(((index % 17) - 8) * 0.63);
    return makeNode({
      id: `stock-dense-${String(ordinal).padStart(2, '0')}`,
      parent_id: parent.id,
      market: 'stock',
      symbol: `S${String(ordinal).padStart(2, '0')}`,
      name: ordinal % 7 === 0
        ? `Synthetic Dense Label Corporation Number ${ordinal}`
        : `Synthetic ${parent.name.split(' ')[0]} ${ordinal}`,
      price: round(8 + ordinal * 2.17),
      market_cap: 650_000_000 + ordinal * ordinal * 115_000_000,
      aum: null,
      volume: 50_000 + ordinal * 123_457,
      daily_change_pct: change,
      weekly_change_pct: round(change * 1.9),
      volume_delta_pct: round(((index % 13) - 6) * 4.3),
      scope_ids: stockScopes(index + STOCK_SEEDS.length),
      boundary_tags: ordinal % 7 === 0 ? ['long-label', 'dense-label'] : ['dense-label'],
    });
  });
  return [...base, ...dense];
}

function makeEtfs() {
  const classes = GROUPS.filter(group => group.market === 'etf');
  return Array.from({ length: 15 }, (_, index) => {
    const ordinal = index + 1;
    const change = index === 0 ? null : round(((index % 9) - 4) * 0.77);
    return makeNode({
      id: `etf-${String(ordinal).padStart(2, '0')}`,
      parent_id: classes[index % classes.length].id,
      market: 'etf',
      symbol: `F${String(ordinal).padStart(2, '0')}`,
      name: `Synthetic ${classes[index % classes.length].name} Fund ${ordinal}`,
      price: round(20 + ordinal * 3.2),
      market_cap: null,
      aum: index === 14 ? 500_000 : 4_000_000_000 + ordinal * 8_750_000_000,
      volume: index === 1 ? 0 : 90_000 + ordinal * 210_000,
      daily_change_pct: change,
      weekly_change_pct: change == null ? null : round(change * 2.1),
      volume_delta_pct: round(((index % 7) - 3) * 8.5),
      scope_ids: [],
      boundary_tags: [
        ...(index === 0 ? ['null-color'] : []),
        ...(index === 1 ? ['zero-volume'] : []),
        ...(index === 14 ? ['tiny-area'] : []),
      ],
    });
  });
}

function makeCrypto() {
  return Array.from({ length: 14 }, (_, index) => {
    const ordinal = index + 1;
    const isBtc = index === 0;
    const change = index === 13 ? -38.5 : round(((index % 11) - 5) * 2.45);
    return makeNode({
      id: `crypto-${String(ordinal).padStart(2, '0')}`,
      parent_id: 'class-digital',
      market: 'crypto',
      symbol: isBtc ? 'BTC-SIM' : `C${String(ordinal).padStart(2, '0')}`,
      name: isBtc ? 'Synthetic Bitcoin Reference Asset' : `Synthetic Digital Asset ${ordinal}`,
      price: isBtc ? 52_000 : round(0.25 + ordinal * 11.7),
      market_cap: isBtc ? 1_050_000_000_000 : 900_000_000 + ordinal * 6_300_000_000,
      aum: null,
      volume: 1_000_000 + ordinal * 13_000_000,
      daily_change_pct: change,
      weekly_change_pct: round(change * 1.8),
      volume_delta_pct: round(((index % 8) - 4) * 12.5),
      scope_ids: [],
      is_btc: isBtc,
      boundary_tags: [
        ...(isBtc ? ['btc-toggle-target', 'dominant-area'] : []),
        ...(index === 13 ? ['negative-extreme'] : []),
      ],
    });
  });
}

function makeNode(input) {
  return Object.freeze({
    id: input.id,
    parent_id: input.parent_id,
    market: input.market,
    symbol: input.symbol,
    name: input.name,
    logo_path: `./public/assets/${input.market}.svg`,
    price: input.price,
    market_cap: input.market_cap,
    aum: input.aum,
    volume: input.volume,
    daily_change_pct: input.daily_change_pct,
    weekly_change_pct: input.weekly_change_pct,
    volume_delta_pct: input.volume_delta_pct,
    scope_ids: input.scope_ids,
    is_btc: input.is_btc === true,
    boundary_tags: input.boundary_tags,
  });
}

function boundaryTags({ marketCap, change, price, volume, name }) {
  return [
    ...(marketCap === null ? ['null-area'] : []),
    ...(marketCap === 1 ? ['minimum-area'] : []),
    ...(marketCap >= 3_000_000_000_000 ? ['dominant-area'] : []),
    ...(change === null ? ['null-color'] : []),
    ...(change === 0 ? ['zero-color'] : []),
    ...(change != null && change >= 20 ? ['positive-extreme'] : []),
    ...(change != null && change <= -20 ? ['negative-extreme'] : []),
    ...(price === null ? ['null-price'] : []),
    ...(volume === null ? ['null-volume'] : []),
    ...(volume === 0 ? ['zero-volume'] : []),
    ...(name.length > 36 ? ['long-label'] : []),
  ];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

const NODES = Object.freeze([...makeStocks(), ...makeEtfs(), ...makeCrypto()]);

export function getFixtureCatalog() {
  return structuredClone({
    schema_version: 1,
    generated_at: GENERATED_AT,
    groups: GROUPS,
    nodes: NODES,
    capabilities: {
      markets: ['stock', 'etf', 'crypto'],
      stock_scopes: STOCK_SCOPES,
      area_metrics: {
        stock: ['market_cap', 'equal'],
        etf: ['aum', 'equal'],
        crypto: ['market_cap', 'equal'],
      },
      color_metrics: {
        stock: ['daily_change_pct', 'weekly_change_pct', 'volume_delta_pct'],
        etf: ['daily_change_pct', 'weekly_change_pct'],
        crypto: ['daily_change_pct', 'weekly_change_pct'],
      },
      grouping: {
        stock: ['sector', 'none'],
        etf: ['asset_class', 'none'],
        crypto: ['none'],
      },
      display_settings: ['logo', 'title', 'value', 'color_scheme'],
      state_scenarios: ['success', 'empty', 'error', 'delayed', 'out-of-order'],
      viewports: ['wide', 'narrow', 'fullscreen'],
    },
  });
}
