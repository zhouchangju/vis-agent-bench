import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
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
  copyFileSync(
    resolve('/Users/zhouchangju/git/gitlab-outer/datav-aigc-vis-adapter/common/compare/placement.js'),
    join(tmp, 'src/placement.js')
  );

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
