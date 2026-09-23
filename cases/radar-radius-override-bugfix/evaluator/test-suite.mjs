import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

/**
 * 隐藏确定性验收套件（场外执行）
 * @param {string} workspacePath - 被测工作区根目录
 */
export async function runHiddenEvaluator(workspacePath = process.cwd()) {
  const targetModulePath = resolve(workspacePath, 'src/dvRadar.js');
  const targetUrl = `${pathToFileURL(targetModulePath).href}?t=${Date.now()}`;

  const results = [];
  let mod;

  try {
    mod = await import(targetUrl);
  } catch (error) {
    return {
      status: 'error',
      summary: `Failed to import ${targetModulePath}: ${error.message}`,
      next_actions: ['Ensure src/dvRadar.js exists and has no syntax errors.'],
      artifacts: [targetModulePath],
      error: {
        root_cause_hint: error.message,
        safe_retry: 'Fix syntax or export errors in src/dvRadar.js',
        stop_condition: 'Cannot evaluate unparseable module.'
      }
    };
  }

  const { parseRadarSysRadius, dvRadarThemeParse } = mod;
  if (typeof parseRadarSysRadius !== 'function') {
    return {
      status: 'error',
      summary: 'Export parseRadarSysRadius is missing or not a function.',
      next_actions: ['Export parseRadarSysRadius from src/dvRadar.js.'],
      artifacts: [targetModulePath]
    };
  }

  const mockToken = {
    dvRadar: {
      radarSysShape: 'circle',
      radarSysRadius: '75%'
    }
  };

  // Test 1: 未提供 radius 时回退到主题默认值
  try {
    const radar = [{}];
    parseRadarSysRadius(radar, null, null, mockToken);
    assert.equal(radar[0].radius, '75%');
    results.push({ name: 'P0_UNDEFINED_FALLBACK', passed: true });
  } catch (e) {
    results.push({ name: 'P0_UNDEFINED_FALLBACK', passed: false, error: e.message });
  }

  // Test 2: 显式传入数字标量 radius: 50 时必须保留 50
  try {
    const radar = [{ radius: 50 }];
    parseRadarSysRadius(radar, null, null, mockToken);
    assert.equal(radar[0].radius, 50);
    results.push({ name: 'P0_SCALAR_NUMBER', passed: true });
  } catch (e) {
    results.push({ name: 'P0_SCALAR_NUMBER', passed: false, error: e.message });
  }

  // Test 3: 显式传入字符串百分比 radius: '60%' 时必须保留 '60%'
  try {
    const radar = [{ radius: '60%' }];
    parseRadarSysRadius(radar, null, null, mockToken);
    assert.equal(radar[0].radius, '60%');
    results.push({ name: 'P0_SCALAR_STRING', passed: true });
  } catch (e) {
    results.push({ name: 'P0_SCALAR_STRING', passed: false, error: e.message });
  }

  // Test 4: 显式传入内外径数组时必须保留
  try {
    const radar = [{ radius: ['15%', '65%'] }];
    parseRadarSysRadius(radar, null, null, mockToken);
    assert.deepEqual(radar[0].radius, ['15%', '65%']);
    results.push({ name: 'P0_ARRAY_FORMAT', passed: true });
  } catch (e) {
    results.push({ name: 'P0_ARRAY_FORMAT', passed: false, error: e.message });
  }

  // Test 5: 边界值 0 必须保留，不得被当做缺失处理
  try {
    const radar = [{ radius: 0 }];
    parseRadarSysRadius(radar, null, null, mockToken);
    assert.equal(radar[0].radius, 0);
    results.push({ name: 'P0_ZERO_BOUNDARY', passed: true });
  } catch (e) {
    results.push({ name: 'P0_ZERO_BOUNDARY', passed: false, error: e.message });
  }

  // Test 6: 多坐标系数组独立处理
  try {
    const radar = [{ radius: 40 }, {}, { radius: '85%' }];
    parseRadarSysRadius(radar, null, null, mockToken);
    assert.equal(radar[0].radius, 40);
    assert.equal(radar[1].radius, '75%');
    assert.equal(radar[2].radius, '85%');
    results.push({ name: 'P0_MULTI_RADAR_SYSTEMS', passed: true });
  } catch (e) {
    results.push({ name: 'P0_MULTI_RADAR_SYSTEMS', passed: false, error: e.message });
  }

  const failed = results.filter(r => !r.passed);
  const allPassed = failed.length === 0;

  return {
    status: allPassed ? 'success' : 'error',
    summary: allPassed
      ? 'All 6/6 hidden acceptance criteria passed.'
      : `${failed.length}/6 acceptance criteria failed: ${failed.map(f => f.name).join(', ')}`,
    details: results,
    next_actions: allPassed ? [] : ['Review failed check assertions and fix radius merge logic.'],
    artifacts: [targetModulePath]
  };
}

if (process.argv[1] === import.meta.filename) {
  const targetDir = process.argv[2] || resolve(import.meta.dirname, '../fixture');
  const result = await runHiddenEvaluator(targetDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'success' ? 0 : 1);
}
