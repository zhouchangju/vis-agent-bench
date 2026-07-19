const STATE_FIELDS = [
  'view',
  'chapterIndex',
  'stepIndex',
  'playing',
  'caption',
  'visibleIds',
  'hiddenIds',
  'dimmedIds',
  'opacities',
  'groups',
  'replacements',
  'scales',
];

export function canonicalState(state = {}) {
  const result = {};
  for (const field of STATE_FIELDS) {
    if (state[field] !== undefined) result[field] = canonicalValue(state[field]);
  }
  return result;
}

export function statesEqual(a, b) {
  return JSON.stringify(canonicalState(a)) === JSON.stringify(canonicalState(b));
}

export function canonicalValue(value) {
  if (typeof value === 'number') return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) {
    return value.map(canonicalValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}
