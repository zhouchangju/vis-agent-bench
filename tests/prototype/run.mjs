import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const setupHtml = readFileSync(resolve(root, 'prototype/setup.html'), 'utf8');
const setupJs = readFileSync(resolve(root, 'prototype/assets/setup.js'), 'utf8');

const checks = [
  ['setup page exposes a model preset selector', () => {
    assert.match(setupHtml, /id="model-profile"/);
  }],
  ['Codex exposes gpt-5.6-luna with maximum reasoning', () => {
    assert.match(setupJs, /id:\s*"gpt-5\.6-luna"/);
    assert.match(setupJs, /gpt-5\.6-luna[\s\S]{0,240}reasoningEffort:\s*"xhigh"/);
  }],
  ['selecting a model profile updates the configured model', () => {
    assert.match(setupJs, /#model-profile/);
    assert.match(setupJs, /reasoning-effort/);
    assert.match(setupJs, /configured_model:\s*\$\("#model"\)\.value/);
  }],
];

const failures = [];
for (const [name, check] of checks) {
  try {
    check();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.message });
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: failures.length ? 'error' : 'success',
  summary: `${checks.length - failures.length}/${checks.length} prototype configuration checks passed.`,
  next_actions: failures.length ? ['Add the Codex model preset and wire it to RunSpec generation.'] : [],
  artifacts: ['tests/prototype/run.mjs', 'prototype/setup.html', 'prototype/assets/setup.js'],
  ...(failures.length ? { failures } : {}),
}, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
