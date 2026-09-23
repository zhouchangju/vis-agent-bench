import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanForAnswerLeakage } from '../../../src/core/file-isolation.mjs';
import { runHiddenEvaluator } from '../../../cases/compare-bubble-adaptive-placement/evaluator/test-suite.mjs';

const root = resolve(import.meta.dirname, '../../..');
const fixturePath = join(root, 'cases/compare-bubble-adaptive-placement/fixture');

// 1. 验证 Fixture 零敏感泄露
const leakages = scanForAnswerLeakage(fixturePath, { detailed: true });
assert.equal(leakages.length, 0, 'Starter fixture should have 0 leakage findings');

// 2. 验证初始 Stub 准确报告未完成
const initialResult = await runHiddenEvaluator(fixturePath);
assert.equal(initialResult.status, 'error', 'Stub fixture must fail hidden evaluation');

// 3. 验证注入真实算法后 100% 通过
const tmp = mkdtempSync(join(tmpdir(), 'compare-bubble-verify-'));
try {
  cpSync(fixturePath, tmp, { recursive: true });

  const solutionCode = `
import {
  COMPARE_BUBBLE_ARROW_OFFSET,
  COMPARE_BUBBLE_BORDER,
  COMPARE_DOT_RADIUS,
} from './constants.js';

function toNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function resolveCompareBubbleMaxWidth({ anchorX, bounds, padding, gap }) {
  const safePadding = toNonNegativeNumber(padding, 10);
  const safeGap = toNonNegativeNumber(gap, 5);
  const anchorClearance = safeGap + COMPARE_DOT_RADIUS;
  const leftBound = bounds.left + safePadding;
  const rightBound = Math.max(leftBound, bounds.right - safePadding);
  return Math.max(0, anchorX - anchorClearance - leftBound, rightBound - anchorX - anchorClearance);
}

export function resolveCompareBubblePosition({
  anchorX,
  anchorY,
  width,
  height,
  bounds,
  placement = 'auto',
  padding,
  gap,
  guideYs,
  avoidOverlap = true,
}) {
  const safePadding = toNonNegativeNumber(padding, 10);
  const safeGap = toNonNegativeNumber(gap, 5);
  const anchorClearance = safeGap + COMPARE_DOT_RADIUS;
  const leftBound = bounds.left + safePadding;
  const rightBound = Math.max(leftBound, bounds.right - safePadding);
  const topBound = bounds.top + safePadding;
  const bottomBound = Math.max(topBound, bounds.bottom - safePadding);
  if (rightBound - leftBound < width || bottomBound - topBound < height) {
    return { visible: false, left: leftBound, top: topBound, side: 'left', vertical: 'middle' };
  }
  const canFitLeft = anchorX - anchorClearance - width >= leftBound;
  const canFitRight = anchorX + anchorClearance + width <= rightBound;
  let side = placement === 'right' ? 'right' : 'left';

  if (placement === 'auto') {
    side = canFitLeft || !canFitRight ? 'left' : 'right';
  } else if (side === 'left' && !canFitLeft && canFitRight) {
    side = 'right';
  } else if (side === 'right' && !canFitRight && canFitLeft) {
    side = 'left';
  }

  let left =
    side === 'left'
      ? anchorX - anchorClearance - width + COMPARE_BUBBLE_BORDER - COMPARE_BUBBLE_ARROW_OFFSET
      : anchorX + anchorClearance - COMPARE_BUBBLE_BORDER + COMPARE_BUBBLE_ARROW_OFFSET;
  left = Math.max(leftBound, Math.min(left, rightBound - width));

  let vertical = 'middle';
  let top = anchorY - height / 2;
  const numericGuides = Array.isArray(guideYs)
    ? guideYs.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
    : [];
  if (avoidOverlap && numericGuides.length === 2) {
    const [upperY, lowerY] = numericGuides;
    const guideGap = lowerY - upperY;
    if (guideGap >= height + safeGap * 2) {
      top = (upperY + lowerY - height) / 2;
    } else if (upperY - topBound >= height + safeGap) {
      top = upperY - height - safeGap;
      vertical = 'above';
    } else if (bottomBound - lowerY >= height + safeGap) {
      top = lowerY + safeGap;
      vertical = 'below';
    }
  }
  top = Math.max(topBound, Math.min(top, bottomBound - height));

  return { visible: true, left, top, side, vertical };
}
`;
  writeFileSync(join(tmp, 'src/placement.js'), solutionCode);

  const fixedResult = await runHiddenEvaluator(tmp);
  assert.equal(fixedResult.status, 'success', 'Real implementation must pass all checks');
  assert.equal(fixedResult.details.every(d => d.passed), true, 'All 6 criteria must pass');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: 'success',
  summary: 'compare-bubble-adaptive-placement case, fixture isolation, and evaluator contracts verified.',
  next_actions: [],
  artifacts: ['cases/compare-bubble-adaptive-placement'],
}));
