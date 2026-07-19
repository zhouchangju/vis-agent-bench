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
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = width * height;
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > EPSILON ? intersection / smallerArea : 0;
}

export function severeNodeOverlaps(nodes, ratio = GEOMETRY_TOLERANCE.severeOverlapRatio) {
  const visible = visibleItems(nodes);
  const failures = [];
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const actual = overlapRatio(visible[i].bounds, visible[j].bounds);
      if (actual > ratio) failures.push({ a: visible[i].id, b: visible[j].id, ratio: actual });
    }
  }
  return failures;
}

export function edgeNodeIntersections(edges, nodes, inset = GEOMETRY_TOLERANCE.edgeNodeInsetPx) {
  const visibleNodes = visibleItems(nodes);
  const failures = [];
  for (const edge of visibleItems(edges)) {
    const points = edge.path || [];
    for (const node of visibleNodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
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
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const points = edge.path || [];
    if (!source || !target || points.length < 2) continue;
    const sourceDistance = distanceToRectBoundary(points[0], source.imageBounds || source.bounds);
    const targetDistance = distanceToRectBoundary(points.at(-1), target.imageBounds || target.bounds);
    if (sourceDistance > tolerance || targetDistance > tolerance) {
      failures.push({ edge: edge.id, sourceDistance, targetDistance });
    }
  }
  return failures;
}

export function positionDrift(before, after) {
  const afterById = new Map((after || []).map(node => [node.id, node]));
  const drift = [];
  for (const node of before || []) {
    const next = afterById.get(node.id);
    if (!next) continue;
    const a = center(node.bounds);
    const b = center(next.bounds);
    drift.push({ id: node.id, distance: Math.hypot(a.x - b.x, a.y - b.y) });
  }
  return drift;
}

export function maximumLayerSpread(nodes = []) {
  const layers = new Map();
  for (const node of visibleItems(nodes)) {
    if (node.layer == null) continue;
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
