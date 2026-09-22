import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

export async function runHiddenEvaluator(workspacePath = process.cwd()) {
  const targetModulePath = resolve(workspacePath, 'src/placement.js');
  const targetUrl = pathToFileURL(targetModulePath).href;

  let mod;
  try {
    mod = await import(targetUrl);
  } catch (error) {
    return {
      status: 'error',
      summary: `Failed to import ${targetModulePath}: ${error.message}`,
      next_actions: ['Ensure src/placement.js exists and has no syntax errors.'],
      artifacts: [targetModulePath],
    };
  }

  const { resolveCompareBubblePosition, resolveCompareBubbleMaxWidth } = mod;
  if (typeof resolveCompareBubblePosition !== 'function') {
    return {
      status: 'error',
      summary: 'resolveCompareBubblePosition is not exported.',
      next_actions: ['Export resolveCompareBubblePosition from src/placement.js'],
      artifacts: [targetModulePath],
    };
  }

  const results = [];

  // Test 1: 自动侧向判定
  try {
    const leftRes = resolveCompareBubblePosition({
      anchorX: 95,
      anchorY: 40,
      width: 80,
      height: 28,
      padding: 8,
      gap: 5,
      bounds: { left: 0, right: 120, top: 0, bottom: 100 },
    });
    const rightRes = resolveCompareBubblePosition({
      anchorX: 15,
      anchorY: 40,
      width: 80,
      height: 28,
      padding: 8,
      gap: 5,
      bounds: { left: 0, right: 120, top: 0, bottom: 100 },
    });
    assert.equal(leftRes.visible, true);
    assert.equal(leftRes.side, 'left', '靠右锚点应选 left');
    assert.equal(rightRes.visible, true);
    assert.equal(rightRes.side, 'right', '靠左锚点应选 right');
    results.push({ name: 'P0_AUTO_SIDE', passed: true });
  } catch (e) {
    results.push({ name: 'P0_AUTO_SIDE', passed: false, error: e.message });
  }

  // Test 2: 显式声明方向在超界时自动翻转
  try {
    const forcedLeftOnLeftEdge = resolveCompareBubblePosition({
      anchorX: 15,
      anchorY: 40,
      width: 80,
      height: 28,
      placement: 'left',
      padding: 8,
      gap: 5,
      bounds: { left: 0, right: 120, top: 0, bottom: 100 },
    });
    const forcedRightOnRightEdge = resolveCompareBubblePosition({
      anchorX: 105,
      anchorY: 40,
      width: 80,
      height: 28,
      placement: 'right',
      padding: 8,
      gap: 5,
      bounds: { left: 0, right: 120, top: 0, bottom: 100 },
    });
    assert.equal(forcedLeftOnLeftEdge.side, 'right', '强制 left 但超界时应翻转为 right');
    assert.equal(forcedRightOnRightEdge.side, 'left', '强制 right 但超界时应翻转为 left');
    results.push({ name: 'P0_EXPLICIT_FLIP', passed: true });
  } catch (e) {
    results.push({ name: 'P0_EXPLICIT_FLIP', passed: false, error: e.message });
  }

  // Test 3: 水平 Clamp 与边界限位
  try {
    const clampedRes = resolveCompareBubblePosition({
      anchorX: 115,
      anchorY: 40,
      width: 50,
      height: 28,
      placement: 'right',
      padding: 8,
      gap: 5,
      bounds: { left: 0, right: 120, top: 0, bottom: 100 },
    });
    assert.ok(clampedRes.left <= 120 - 8 - 50, '不得超出右侧 padding 边界');
    assert.ok(clampedRes.left >= 8, '不得超出左侧 padding 边界');
    results.push({ name: 'P0_HORIZONTAL_CLAMP', passed: true });
  } catch (e) {
    results.push({ name: 'P0_HORIZONTAL_CLAMP', passed: false, error: e.message });
  }

  // Test 4: 辅助线垂直避让
  try {
    const verticalAboveRes = resolveCompareBubblePosition({
      anchorX: 60,
      anchorY: 50,
      width: 40,
      height: 20,
      guideYs: [45, 55], // 间距 10 < height 20
      avoidOverlap: true,
      padding: 5,
      gap: 5,
      bounds: { left: 0, right: 120, top: 0, bottom: 100 },
    });
    assert.equal(verticalAboveRes.vertical, 'above', '狭窄辅助线间隙应避让至上方');
    assert.ok(verticalAboveRes.top <= 45 - 20 - 5);
    results.push({ name: 'P0_VERTICAL_GUIDE_AVOIDANCE', passed: true });
  } catch (e) {
    results.push({ name: 'P0_VERTICAL_GUIDE_AVOIDANCE', passed: false, error: e.message });
  }

  // Test 5: 视口过小不显示
  try {
    const hiddenRes = resolveCompareBubblePosition({
      anchorX: 10,
      anchorY: 10,
      width: 100,
      height: 40,
      padding: 5,
      bounds: { left: 0, right: 50, top: 0, bottom: 30 },
    });
    assert.equal(hiddenRes.visible, false, '空间不足以容纳宽高时应返回 visible: false');
    results.push({ name: 'P0_SMALL_VIEWPORT', passed: true });
  } catch (e) {
    results.push({ name: 'P0_SMALL_VIEWPORT', passed: false, error: e.message });
  }

  // Test 6: 最大可用宽度
  try {
    assert(typeof resolveCompareBubbleMaxWidth === 'function', 'resolveCompareBubbleMaxWidth 需为函数');
    const maxW = resolveCompareBubbleMaxWidth({
      anchorX: 100,
      bounds: { left: 0, right: 300, top: 0, bottom: 100 },
      padding: 10,
      gap: 5,
    });
    // 右边可用: 300 - 10 - 100 - (5 + 3.5) = 190 - 8.5 = 181.5
    assert.ok(maxW > 150, '应返回右侧更大的可用宽度');
    results.push({ name: 'P0_MAX_WIDTH', passed: true });
  } catch (e) {
    results.push({ name: 'P0_MAX_WIDTH', passed: false, error: e.message });
  }

  const failed = results.filter(r => !r.passed);
  const allPassed = failed.length === 0;

  return {
    status: allPassed ? 'success' : 'error',
    summary: allPassed
      ? 'All 6/6 placement criteria passed.'
      : `${failed.length}/6 criteria failed: ${failed.map(f => f.name).join(', ')}`,
    details: results,
    next_actions: allPassed ? [] : ['Review geometry rules in placement.js and fix coordinate calculation.'],
    artifacts: [targetModulePath],
  };
}

if (process.argv[1] === import.meta.filename) {
  const targetDir = process.argv[2] || resolve(import.meta.dirname, '../fixture');
  const result = await runHiddenEvaluator(targetDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'success' ? 0 : 1);
}
