import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompareBubblePosition, resolveCompareBubbleMaxWidth } from '../src/placement.js';

test('左侧空间充足且为末项时，优先放置在左侧', () => {
  const result = resolveCompareBubblePosition({
    anchorX: 95,
    anchorY: 40,
    width: 80,
    height: 28,
    padding: 8,
    gap: 5,
    bounds: { left: 0, right: 120, top: 0, bottom: 100 },
  });
  assert.equal(result.visible, true);
  assert.equal(result.side, 'left');
});

test('左侧空间不足且右侧空间充足时，自动翻转到右侧', () => {
  const result = resolveCompareBubblePosition({
    anchorX: 15,
    anchorY: 40,
    width: 80,
    height: 28,
    padding: 8,
    gap: 5,
    bounds: { left: 0, right: 120, top: 0, bottom: 100 },
  });
  assert.equal(result.visible, true);
  assert.equal(result.side, 'right');
});

test('容器过小时返回 visible: false', () => {
  const result = resolveCompareBubblePosition({
    anchorX: 20,
    anchorY: 20,
    width: 100,
    height: 50,
    bounds: { left: 0, right: 50, top: 0, bottom: 30 },
  });
  assert.equal(result.visible, false);
});
