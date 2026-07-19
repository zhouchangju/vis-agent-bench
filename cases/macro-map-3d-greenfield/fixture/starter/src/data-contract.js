const RELATION_TYPES = new Set(['positive', 'negative', 'unknown']);
const LAYERS = new Set(['core', 'peripheral']);

export function validateGraphData(value) {
  const issues = [];
  if (!value || typeof value !== 'object') {
    return failure('Graph payload must be an object.', ['$']);
  }
  if (!Array.isArray(value.nodes)) issues.push('$.nodes must be an array');
  if (!Array.isArray(value.relations)) issues.push('$.relations must be an array');
  if (issues.length > 0) return failure('Graph payload has invalid collections.', issues);

  const ids = new Set();
  for (const [index, node] of value.nodes.entries()) {
    const path = `$.nodes[${index}]`;
    if (typeof node?.id !== 'string' || node.id.length === 0) issues.push(`${path}.id`);
    else if (ids.has(node.id)) issues.push(`${path}.id duplicate`);
    else ids.add(node.id);
    if (typeof node?.labels?.zh !== 'string' || typeof node?.labels?.en !== 'string') {
      issues.push(`${path}.labels`);
    }
    if (typeof node?.category !== 'string' || node.category.length === 0) issues.push(`${path}.category`);
    if (!LAYERS.has(node?.layer)) issues.push(`${path}.layer`);
    if (typeof node?.importance !== 'number' || !Number.isFinite(node.importance)) {
      issues.push(`${path}.importance`);
    }
    if (!node?.values || typeof node.values !== 'object') issues.push(`${path}.values`);
    for (const forbidden of ['x', 'y', 'z', 'position', 'radius', 'angle']) {
      if (Object.hasOwn(node ?? {}, forbidden)) issues.push(`${path}.${forbidden} is answer-bearing`);
    }
  }

  const relationIds = new Set();
  for (const [index, relation] of value.relations.entries()) {
    const path = `$.relations[${index}]`;
    if (typeof relation?.id !== 'string' || relationIds.has(relation.id)) issues.push(`${path}.id`);
    else relationIds.add(relation.id);
    if (!ids.has(relation?.source)) issues.push(`${path}.source`);
    if (!ids.has(relation?.target)) issues.push(`${path}.target`);
    if (!RELATION_TYPES.has(relation?.type)) issues.push(`${path}.type`);
    if (typeof relation?.primary !== 'boolean') issues.push(`${path}.primary`);
  }

  if (!Array.isArray(value.meta?.metrics) || value.meta.metrics.length < 2) issues.push('$.meta.metrics');
  if (!Array.isArray(value.meta?.periods) || value.meta.periods.length < 2) issues.push('$.meta.periods');

  if (issues.length > 0) return failure(`Graph payload has ${issues.length} contract issue(s).`, issues);
  return {
    status: 'success',
    summary: `Validated ${value.nodes.length} nodes and ${value.relations.length} relations.`,
    next_actions: [],
    artifacts: [],
    stats: {
      nodes: value.nodes.length,
      relations: value.relations.length,
      core_nodes: value.nodes.filter((node) => node.layer === 'core').length,
    },
  };
}

function failure(summary, details) {
  return {
    status: 'error',
    summary,
    next_actions: ['Correct the listed paths and retry validation.'],
    artifacts: [],
    details,
    error: {
      root_cause_hint: summary,
      safe_retry: 'Correct only the reported fields, then rerun validation.',
      stop_condition: 'Stop if the same paths fail twice and review data/contract.md.',
    },
  };
}
