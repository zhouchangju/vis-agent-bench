// Deterministic bidirectional-tree helpers used by the StandardChart
// two-way-tree checks. These never read the fixture directly: the observation
// carries the declared upstream/downstream edges and the expected traversal
// is derived from them.

export const OVERLAP_TOLERANCE = 0;
export const FOCUS_DRIFT_TOLERANCE = 0;
export const LARGE_TREE_NODE_BUDGET = 200;

/**
 * Walk the declared upstream/downstream edges from a starting node and return
 * the set of reachable node ids in each direction.
 *
 * Edge semantics:
 *   - upstream edge `{from: supplier, to: consumer}` means `from` is an
 *     upstream input of `to`.
 *   - downstream edge `{from: producer, to: consumer}` means `to` is a
 *     downstream consumer of `from`.
 *
 * To traverse upstream from the focus we hop from consumer to supplier, so we
 * key the upstream adjacency by `edge.to`. To traverse downstream we hop from
 * producer to consumer, so we key the downstream adjacency by `edge.from`.
 *
 * @param {Array<{from:string,to:string,direction:string}>} edges
 * @param {string} focusId
 * @returns {{ upstream:string[], downstream:string[] }}
 */
export function bidirectionalReachable(edges, focusId) {
  const upstreamAdjacency = new Map();
  const downstreamAdjacency = new Map();
  for (const edge of edges || []) {
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
    if (edge.direction === 'upstream') {
      const list = upstreamAdjacency.get(edge.to) || [];
      list.push(edge.from);
      upstreamAdjacency.set(edge.to, list);
    } else if (edge.direction === 'downstream') {
      const list = downstreamAdjacency.get(edge.from) || [];
      list.push(edge.to);
      downstreamAdjacency.set(edge.from, list);
    }
  }
  return {
    upstream: walk(upstreamAdjacency, focusId),
    downstream: walk(downstreamAdjacency, focusId),
  };
}

function walk(adjacency, start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) || []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  seen.delete(start);
  return [...seen].sort();
}

/**
 * Detect node bounding-box overlaps within a single direction column.
 *
 * Each entry is `{ id, direction, x, y, width, height }`. The check is axis
 * aligned and deterministic; sub-pixel rounding is the candidate's problem,
 * not the evaluator's.
 */
export function overlapFailures(boxes = []) {
  const byDirection = new Map();
  for (const box of boxes) {
    if (!box || !box.direction) continue;
    const list = byDirection.get(box.direction) || [];
    list.push(box);
    byDirection.set(box.direction, list);
  }
  const failures = [];
  for (const [direction, list] of byDirection) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (rectanglesOverlap(a, b)) {
          failures.push({ direction, a: a.id, b: b.id });
        }
      }
    }
  }
  return failures;
}

function rectanglesOverlap(a, b) {
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.width) || !Number.isFinite(a.height)) return false;
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return false;
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  return a.x < bRight && b.x < aRight && a.y < bBottom && b.y < aBottom;
}
