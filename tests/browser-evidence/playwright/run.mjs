import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPlaywrightDriver,
  validatePlaywrightSpec,
} from '../../../src/browser-evidence/drivers/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outputRoot = '/tmp/vis-agent-bench-vab-t11';
const fixture = readFileSync(join(here, 'fixtures', 'index.html'));

function readSpec(name) {
  return JSON.parse(readFileSync(join(here, name), 'utf8'));
}

function startServer() {
  const server = createServer((request, response) => {
    if (new URL(request.url, 'http://127.0.0.1').pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fixture);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(41771, '127.0.0.1', () => resolvePromise(server));
  });
}

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    checks.push({ name, error: error.stack });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  }
}

rmSync(outputRoot, { recursive: true, force: true });
const server = await startServer();
try {
  await check('restricted spec rejects arbitrary code and non-local navigation', () => {
    const arbitrary = readSpec('success.smoke.json');
    arbitrary.steps[1] = { kind: 'evaluate', expression: 'process.exit()' };
    const invalidAction = validatePlaywrightSpec(arbitrary);
    assert.equal(invalidAction.valid, false);
    assert.ok(invalidAction.errors.some(error => error.code === 'ENUM'));

    const remote = readSpec('success.smoke.json');
    remote.steps[0].url = 'https://example.com/';
    const invalidUrl = validatePlaywrightSpec(remote);
    assert.equal(invalidUrl.valid, false);
    assert.ok(invalidUrl.errors.some(error => error.code === 'LOCAL_URL_ONLY'));
  });

  await check('real local Chromium happy path emits stable evidence', async () => {
    const result = await createPlaywrightDriver().capture(readSpec('success.smoke.json'), {
      outDir: join(outputRoot, 'success'),
    });
    assert.equal(result.status, 'success', JSON.stringify(result.errors, null, 2));
    assert.equal(result.evidence.driver, 'playwright-chromium');
    assert.match(result.evidence.environment.browser_version, /^\d+\./);
    assert.equal(result.evidence.viewport.width, 800);
    assert.ok(result.evidence.console_messages.some(entry => entry.message === 'fixture-ready'));
    assert.equal(result.evidence.screenshots.length, 1);
    assert.ok(result.evidence.screenshots[0].digest.startsWith('sha256-'));
    const state = result.evidence.dom_snapshots.find(item => item.label === 'final-state');
    assert.equal(state.summary.selectors[0].text, 'Keyboard accepted');
    assert.equal(state.summary.node_counts.canvas, 1);
    assert.ok(state.summary.canvases[0].encoded_length > 100);
    assert.equal(state.summary.canvases[0].drawing_non_empty, true);
    assert.equal(result.evidence.canvas_webgl_proven, false);
    assert.ok(existsSync(join(outputRoot, 'success', 'browser-evidence.json')));
    assert.ok(existsSync(join(outputRoot, 'success', 'final.png')));
  });

  await check('intentional selector/assert failures stay product-classified', async () => {
    const result = await createPlaywrightDriver().capture(readSpec('failure.smoke.json'), {
      outDir: join(outputRoot, 'failure'),
    });
    assert.equal(result.status, 'warning', JSON.stringify(result.errors, null, 2));
    const codes = result.evidence.failures.map(item => item.code);
    assert.ok(codes.includes('SELECTOR_MISSING') || codes.includes('ACTION_TIMEOUT'));
    assert.ok(codes.includes('ASSERT_FAILED'));
    assert.ok(codes.includes('PAGE_ERROR'));
    assert.ok(codes.includes('NETWORK_FAILURE'));
    assert.ok(result.evidence.console_errors.some(item => item.message === 'intentional-console-error'));
    assert.ok(result.evidence.page_errors.some(item => item.message === 'intentional-page-error'));
    assert.ok(result.evidence.network_events.some(item => item.url.endsWith('/missing.json')));
    assert.ok(result.evidence.failures.every(item => item.failure_class === 'product'));
    assert.ok(existsSync(join(outputRoot, 'failure', 'browser-evidence.json')));
    assert.ok(existsSync(join(outputRoot, 'failure', 'failure.png')));
  });

  await check('navigation failure is distinct from product failure', async () => {
    const spec = readSpec('success.smoke.json');
    spec.capture_id = 'vab-t11-navigation-failure';
    spec.steps = [{ kind: 'goto', url: 'http://127.0.0.1:41772/', timeout_ms: 300 }];
    const result = await createPlaywrightDriver().capture(spec);
    assert.equal(result.status, 'error');
    assert.equal(result.evidence.failures[0].code, 'LOAD_FAILED');
    assert.equal(result.evidence.failures[0].failure_class, 'navigation');
  });

  await check('browser startup failure is environment-classified', async () => {
    const load = () => {
      throw new Error('synthetic missing Playwright');
    };
    const result = await createPlaywrightDriver({ load }).capture(readSpec('success.smoke.json'));
    assert.equal(result.status, 'error');
    assert.equal(result.evidence.failures[0].code, 'DRIVER_UNAVAILABLE');
    assert.equal(result.evidence.failures[0].failure_class, 'environment');
    assert.equal(result.evidence.action_log.length, 0);
  });
} finally {
  await new Promise(resolvePromise => server.close(resolvePromise));
}

const summary = {
  status: checks.length ? 'error' : 'success',
  summary: checks.length ? `${checks.length} Playwright check(s) failed.` : '5/5 Playwright checks passed.',
  next_actions: checks.length ? ['Fix the failing Playwright Driver checks.'] : [],
  artifacts: [
    join(outputRoot, 'success', 'browser-evidence.json'),
    join(outputRoot, 'success', 'final.png'),
    join(outputRoot, 'failure', 'browser-evidence.json'),
    join(outputRoot, 'failure', 'failure.png'),
  ],
  ...(checks.length ? { failures: checks } : {}),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (checks.length) process.exitCode = 1;
