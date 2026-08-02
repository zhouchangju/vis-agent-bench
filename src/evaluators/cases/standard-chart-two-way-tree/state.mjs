// Deterministic business-state comparison for the StandardChart two-way tree.
//
// State comparisons ignore ordering of the visible-id list and sub-pixel
// geometry, but still catch changes to selection, expand path, focus node,
// and visible node set.

const BUSINESS_STATE_FIELDS = [
  'focusId',
  'selectedId',
  'expandedUpstream',
  'expandedDownstream',
  'visibleIds',
  'theme',
  'group',
];

export function canonicalTreeState(state = {}) {
  return Object.fromEntries(
    BUSINESS_STATE_FIELDS
      .filter(field => state[field] !== undefined)
      .map(field => [field, canonicalValue(state[field])]),
  );
}

export function treeStatesEqual(a, b) {
  return JSON.stringify(canonicalTreeState(a)) === JSON.stringify(canonicalTreeState(b));
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
