const BUSINESS_STATE_FIELDS = [
  'market',
  'dataSource',
  'areaMetric',
  'colorMetric',
  'groupBy',
  'includeBtc',
  'search',
  'drillPath',
  'visibleIds',
];

export function canonicalBusinessState(state = {}) {
  return Object.fromEntries(
    BUSINESS_STATE_FIELDS
      .filter(field => state[field] !== undefined)
      .map(field => [field, canonicalValue(state[field])]),
  );
}

export function businessStatesEqual(a, b) {
  return JSON.stringify(canonicalBusinessState(a)) === JSON.stringify(canonicalBusinessState(b));
}

function canonicalValue(value) {
  if (typeof value === 'number') return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) {
    return value.map(canonicalValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}
