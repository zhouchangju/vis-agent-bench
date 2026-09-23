import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const setupHtml = readFileSync(resolve(root, 'prototype/setup.html'), 'utf8');
const setupJs = readFileSync(resolve(root, 'prototype/assets/setup.js'), 'utf8');

const utilsJs = readFileSync(resolve(root, 'prototype/assets/utils.js'), 'utf8');
const runsHtml = readFileSync(resolve(root, 'prototype/runs.html'), 'utf8');
const evidenceHtml = readFileSync(resolve(root, 'prototype/evidence.html'), 'utf8');
const compareHtml = readFileSync(resolve(root, 'prototype/compare.html'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'prototype/index.html'), 'utf8');

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
  ['prototype utils exports escapeHtml that escapes HTML special characters', () => {
    assert.match(utilsJs, /function escapeHtml/);
    // Evaluate escapeHtml in an isolated context
    const fn = new Function(utilsJs + '; return escapeHtml;')();
    assert.equal(fn('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.equal(fn('\'test\' & "ok"'), '&#39;test&#39; &amp; &quot;ok&quot;');
  }],
  ['dashboard pages include utils.js and escape dynamic output', () => {
    assert.match(runsHtml, /src="\.\/assets\/utils\.js"/);
    assert.match(runsHtml, /escapeHtml\(run\.run_id\)/);
    assert.match(evidenceHtml, /src="\.\/assets\/utils\.js"/);
    assert.match(evidenceHtml, /escapeHtml\(r\.run_id\)/);
    assert.match(compareHtml, /src="\.\/assets\/utils\.js"/);
    assert.match(compareHtml, /escapeHtml\(sid\)/);
  }],
  ['landing index page links to all prototype sub-pages', () => {
    assert.match(indexHtml, /href="\.\/setup\.html"/);
    assert.match(indexHtml, /href="\.\/runs\.html"/);
    assert.match(indexHtml, /href="\.\/compare\.html"/);
    assert.match(indexHtml, /href="\.\/evidence\.html"/);
    assert.match(indexHtml, /href="\.\/review\.html"/);
    assert.match(indexHtml, /href="\.\/report\.html"/);
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
