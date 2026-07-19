export const AREA_SHARE_TOLERANCE = 0.02;
export const COLOR_POSITION_TOLERANCE = 0.001;

export function areaShareFailures(cases = [], tolerance = AREA_SHARE_TOLERANCE) {
  const failures = [];
  for (const areaCase of cases) {
    const nodes = areaCase.nodes || [];
    const invalidNodes = nodes.filter(node => (
      !Number.isFinite(node.renderedArea)
      || node.renderedArea <= 0
      || (areaCase.metric !== 'equal' && (!Number.isFinite(node.inputValue) || node.inputValue <= 0))
    ));
    if (invalidNodes.length) {
      failures.push({
        caseId: areaCase.id,
        reason: 'area inputs and rendered areas must be finite and positive',
        nodeIds: invalidNodes.map(node => node.id),
      });
      continue;
    }
    const renderedTotal = sum(nodes.map(node => node.renderedArea));
    const expectedWeights = nodes.map(node => areaCase.metric === 'equal' ? 1 : node.inputValue);
    const expectedTotal = sum(expectedWeights);
    if (!nodes.length || renderedTotal <= 0 || expectedTotal <= 0) {
      failures.push({ caseId: areaCase.id, reason: 'non-positive or empty area totals' });
      continue;
    }
    nodes.forEach((node, index) => {
      const actual = node.renderedArea / renderedTotal;
      const expected = expectedWeights[index] / expectedTotal;
      const error = Math.abs(actual - expected);
      if (!Number.isFinite(error) || error > tolerance) {
        failures.push({ caseId: areaCase.id, nodeId: node.id, actual, expected, error });
      }
    });
    if (areaCase.metric !== 'equal') {
      const expectedOrder = [...nodes]
        .sort((left, right) => right.inputValue - left.inputValue)
        .map(node => node.id);
      const observedOrder = [...nodes]
        .sort((left, right) => right.renderedArea - left.renderedArea)
        .map(node => node.id);
      if (expectedOrder.join('\0') !== observedOrder.join('\0')) {
        failures.push({ caseId: areaCase.id, reason: 'rendered area ordering differs from input ordering' });
      }
    }
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const group of areaCase.groups || []) {
      const missingChildIds = (group.childIds || []).filter(id => !byId.has(id));
      const childArea = sum((group.childIds || []).map(id => byId.get(id)?.renderedArea));
      const error = Math.abs(group.renderedArea - childArea) / Math.max(1, childArea);
      if (missingChildIds.length || !Number.isFinite(error) || error > tolerance) {
        failures.push({
          caseId: areaCase.id,
          groupId: group.id,
          actual: group.renderedArea,
          expected: childArea,
          error,
          missingChildIds,
        });
      }
    }
  }
  return failures;
}

export function expectedColorPosition(value, domain) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  const clamped = domain.clamp
    ? Math.min(domain.softMax, Math.max(domain.softMin, numeric))
    : numeric;
  if (clamped === domain.neutral) return 0.5;
  if (clamped < domain.neutral) {
    return 0.5 * (clamped - domain.softMin) / (domain.neutral - domain.softMin);
  }
  return 0.5 + 0.5 * (clamped - domain.neutral) / (domain.softMax - domain.neutral);
}

export function colorMappingFailures(color = {}, tolerance = COLOR_POSITION_TOLERANCE) {
  const domain = color.domain || {};
  const failures = [];
  for (const sample of color.samples || []) {
    const expected = expectedColorPosition(sample.value, domain);
    if (sample.value == null) {
      if (sample.treatment !== 'no-data' || sample.position != null) {
        failures.push({ id: sample.id, reason: 'null color must use no-data treatment' });
      }
      continue;
    }
    const error = Math.abs(sample.position - expected);
    if (!Number.isFinite(error) || error > tolerance) {
      failures.push({ id: sample.id, actual: sample.position, expected, error });
    }
  }
  return failures;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}
