import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanForAnswerLeakage } from '../../../src/core/file-isolation.mjs';
import { runHiddenEvaluator } from '../../../cases/radar-radius-override-bugfix/evaluator/test-suite.mjs';

const root = resolve(import.meta.dirname, '../../..');
const fixturePath = join(root, 'cases/radar-radius-override-bugfix/fixture');

// 1. 验证 Fixture 零敏感信息泄露
const leakages = scanForAnswerLeakage(fixturePath, { detailed: true });
assert.equal(leakages.length, 0, 'Starter fixture should have 0 leakage findings');

// 2. 验证隐藏评估器在初始有 Bug 的代码上能准确检出失败
const initialResult = await runHiddenEvaluator(fixturePath);
assert.equal(initialResult.status, 'error', 'Initial fixture must fail evaluator because bug is present');
assert.equal(initialResult.details.find(d => d.name === 'P0_UNDEFINED_FALLBACK').passed, true);
assert.equal(initialResult.details.find(d => d.name === 'P0_SCALAR_NUMBER').passed, false);

// 3. 验证隐藏评估器在正确修复后 100% 通过
const tmp = mkdtempSync(join(tmpdir(), 'radar-fix-verify-'));
try {
  cpSync(fixturePath, tmp, { recursive: true });
  const dvRadarFile = join(tmp, 'src/dvRadar.js');
  let content = readFileSync(dvRadarFile, 'utf8');
  content = content.replace(
    /if \(!isObject\(radar\.radius\)\) \{[\s\S]*?\} else \{[\s\S]*?\}/,
    'radar.radius = overrideIfUndefined(radar.radius, themeRadarSysRadius);'
  );
  writeFileSync(dvRadarFile, content);

  const fixedResult = await runHiddenEvaluator(tmp);
  assert.equal(fixedResult.status, 'success', 'Fixed code must pass all evaluator checks');
  assert.equal(fixedResult.details.every(d => d.passed), true, 'All 6 criteria must pass');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: 'success',
  summary: 'radar-radius-override-bugfix case, fixture isolation, and evaluator contracts verified.',
  next_actions: [],
  artifacts: ['cases/radar-radius-override-bugfix']
}));
