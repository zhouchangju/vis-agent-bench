// Synthetic industry-chain data loader.
//
// The data shape is intentionally simpler than the production StandardChart
// option: every node is `{ id, name, changePct, group? }` and every edge is
// `{ from, to, direction }` where direction is one of:
//   - 'upstream'   : `from` is an upstream input of `to`
//   - 'downstream' : `from` is a downstream consumer of `to`
//
// In the real product both directions are stored on the same edge with a
// bidirectional flag, but this Starter keeps them as separate declarations
// so the candidate must implement the *bidirectional* traversal on top —
// that is the deliberate gap left for the agent to fill.

import sampleData from '../public/assets/sample-data.json' with { type: 'json' };

export const TWO_WAY_DIRECTIONS = Object.freeze(['upstream', 'downstream']);

export function loadIndustryChain() {
  const nodes = (sampleData.nodes || []).map(node => ({
    id: String(node.id),
    name: String(node.name),
    changePct: typeof node.changePct === 'number' ? node.changePct : null,
    group: typeof node.group === 'string' && node.group.length ? node.group : null,
  }));
  const edges = (sampleData.edges || []).map(edge => ({
    from: String(edge.from),
    to: String(edge.to),
    direction: TWO_WAY_DIRECTIONS.includes(edge.direction) ? edge.direction : null,
  }));
  return Object.freeze({
    schema_version: sampleData.schema_version,
    generated_at: sampleData.generated_at,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    root_id: sampleData.root_id,
  });
}

// Naive, intentionally incomplete graph helper. The candidate is expected to
// replace this with a proper bidirectional tree traversal that supports
// asymmetric depth, one-sided trees, and stable path highlighting.
export function listNeighbours(chain, nodeId, direction) {
  if (!TWO_WAY_DIRECTIONS.includes(direction)) return [];
  return chain.edges
    .filter(edge => edge.direction === direction)
    .flatMap(edge => {
      if (direction === 'upstream' && edge.to === nodeId) return [edge.from];
      if (direction === 'downstream' && edge.from === nodeId) return [edge.to];
      return [];
    });
}
