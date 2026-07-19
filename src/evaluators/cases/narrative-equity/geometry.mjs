const EPSILON = 1e-9;

export const GEOMETRY_TOLERANCE = Object.freeze({
  severeOverlapRatio: 0.08,
  edgeNodeInsetPx: 2,
  endpointBoundaryPx: 6,
  stablePositionPx: 2,
  layerAlignmentPx: 4,
});

export function visibleItems(items = []) {
  return items.filter(item => item && item.visible !== false);
}

export function overlapRatio(a, b) {
  if (!validRect(a) || !validRect(b)) return Number.POSITIVE_INFINITY;
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > EPSILON ? intersection / smallerArea : 0;
}

export function severeNodeOverlaps(nodes, ratio = GEOMETRY_TOLERANCE.severeOverlapRatio) {
  const visible = visibleItems(nodes);
  const failures = [];
  for (const node of visible) {
    if (!node.id || !validRect(node.bounds)) {
      failures.push({ node: node.id ?? null, reason: 'missing-or-invalid-bounds' });
    }
  }
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      if (!validRect(visible[i].bounds) || !validRect(visible[j].bounds)) continue;
      const actual = overlapRatio(visible[i].bounds, visible[j].bounds);
      if (actual > ratio) failures.push({ a: visible[i].id, b: visible[j].id, ratio: actual });
    }
  }
  return failures;
}

export function edgeNodeIntersections(edges, nodes, inset = GEOMETRY_TOLERANCE.edgeNodeInsetPx) {
  const visibleNodes = visibleItems(nodes);
  const nodeIds = new Set(visibleNodes.map(node => node.id));
  const failures = [];
  for (const node of visibleNodes) {
    if (!node.id || !validRect(node.bounds)) {
      failures.push({ node: node.id ?? null, reason: 'missing-or-invalid-bounds' });
    }
  }
  for (const edge of visibleItems(edges)) {
    if (!edge.id || !edge.source || !edge.target) {
      failures.push({ edge: edge.id ?? null, reason: 'missing-edge-id-source-or-target' });
      continue;
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      failures.push({
        edge: edge.id,
        reason: 'unknown-endpoint',
        source: edge.source,
        target: edge.target,
      });
      continue;
    }
    const points = edge.path;
    if (!validPath(points)) {
      failures.push({ edge: edge.id, reason: 'missing-or-invalid-path' });
      continue;
    }
    for (const node of visibleNodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      if (!validRect(node.bounds)) continue;
      const rect = insetRect(node.bounds, inset);
      for (let i = 1; i < points.length; i += 1) {
        if (segmentIntersectsRect(points[i - 1], points[i], rect)) {
          failures.push({ edge: edge.id, node: node.id, segment: i - 1 });
          break;
        }
      }
    }
  }
  return failures;
}

export function endpointBoundaryFailures(edges, nodes, tolerance = GEOMETRY_TOLERANCE.endpointBoundaryPx) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const failures = [];
  for (const edge of visibleItems(edges)) {
    if (!edge.id || !edge.source || !edge.target) {
      failures.push({ edge: edge.id ?? null, reason: 'missing-edge-id-source-or-target' });
      continue;
    }
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      failures.push({
        edge: edge.id,
        reason: 'unknown-endpoint',
        source: edge.source,
        target: edge.target,
      });
      continue;
    }
    const points = edge.path;
    if (!validPath(points)) {
      failures.push({ edge: edge.id, reason: 'missing-or-invalid-path' });
      continue;
    }
    const sourceBounds = source.imageBounds || source.bounds;
    const targetBounds = target.imageBounds || target.bounds;
    if (!validRect(sourceBounds) || !validRect(targetBounds)) {
      failures.push({ edge: edge.id, reason: 'missing-or-invalid-endpoint-bounds' });
      continue;
    }
    const sourceDistance = distanceToRectBoundary(points[0], sourceBounds);
    const targetDistance = distanceToRectBoundary(points.at(-1), targetBounds);
    if (sourceDistance > tolerance || targetDistance > tolerance) {
      failures.push({ edge: edge.id, sourceDistance, targetDistance });
    }
  }
  return failures;
}

export function positionDrift(before, after) {
  const beforeItems = before || [];
  const afterItems = after || [];
  const beforeById = new Map(beforeItems.map(node => [node.id, node]));
  const afterById = new Map(afterItems.map(node => [node.id, node]));
  const drift = [];
  let common = 0;
  for (const node of beforeItems) {
    if (!node.id || !validRect(node.bounds)) {
      drift.push({ id: node.id ?? null, reason: 'missing-or-invalid-before-bounds' });
      continue;
    }
    const next = afterById.get(node.id);
    if (!next) {
      drift.push({ id: node.id, reason: 'entity-missing-after' });
      continue;
    }
    common += 1;
    if (!validRect(next.bounds)) {
      drift.push({ id: node.id, reason: 'missing-or-invalid-after-bounds' });
      continue;
    }
    const a = center(node.bounds);
    const b = center(next.bounds);
    drift.push({ id: node.id, distance: Math.hypot(a.x - b.x, a.y - b.y) });
  }
  for (const node of afterItems) {
    if (!beforeById.has(node.id)) {
      drift.push({ id: node.id ?? null, reason: 'entity-missing-before' });
    }
  }
  if (beforeItems.length > 0 && afterItems.length > 0 && common === 0) {
    drift.push({ id: null, reason: 'no-common-entity' });
  }
  return drift;
}

export function maximumLayerSpread(nodes = []) {
  const layers = new Map();
  for (const node of visibleItems(nodes)) {
    if (node.layer == null) continue;
    if (!validRect(node.bounds)) return Number.POSITIVE_INFINITY;
    const y = center(node.bounds).y;
    const values = layers.get(node.layer) || [];
    values.push(y);
    layers.set(node.layer, values);
  }
  let maximum = 0;
  for (const values of layers.values()) {
    maximum = Math.max(maximum, Math.max(...values) - Math.min(...values));
  }
  return maximum;
}

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function validRect(rect) {
  return rect
    && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0
    && rect.height > 0;
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validPath(points) {
  return Array.isArray(points) && points.length >= 2 && points.every(validPoint);
}

function insetRect(rect, inset) {
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(0, rect.width - inset * 2),
    height: Math.max(0, rect.height - inset * 2),
  };
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function intersects(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (oppositeSigns(o1, o2) && oppositeSigns(o3, o4)) return true;
  return (Math.abs(o1) <= EPSILON && onSegment(a, b, c))
    || (Math.abs(o2) <= EPSILON && onSegment(a, b, d))
    || (Math.abs(o3) <= EPSILON && onSegment(c, d, a))
    || (Math.abs(o4) <= EPSILON && onSegment(c, d, b));
}

function oppositeSigns(a, b) {
  return (a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON);
}

function onSegment(a, b, point) {
  return point.x >= Math.min(a.x, b.x) - EPSILON
    && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON
    && point.y <= Math.max(a.y, b.y) + EPSILON;
}

function segmentIntersectsRect(a, b, rect) {
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  const tl = { x: rect.x, y: rect.y };
  const tr = { x: rect.x + rect.width, y: rect.y };
  const br = { x: rect.x + rect.width, y: rect.y + rect.height };
  const bl = { x: rect.x, y: rect.y + rect.height };
  return intersects(a, b, tl, tr) || intersects(a, b, tr, br)
    || intersects(a, b, br, bl) || intersects(a, b, bl, tl);
}

function distanceToRectBoundary(point, rect) {
  const outsideX = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const outsideY = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  if (outsideX > 0 || outsideY > 0) return Math.hypot(outsideX, outsideY);
  return Math.min(
    Math.abs(point.x - rect.x),
    Math.abs(point.x - (rect.x + rect.width)),
    Math.abs(point.y - rect.y),
    Math.abs(point.y - (rect.y + rect.height)),
  );
}
