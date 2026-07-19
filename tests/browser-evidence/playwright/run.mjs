import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createPlaywrightDriver,
  MAX_PLAYWRIGHT_STEPS,
  validatePlaywrightSpec,
} from '../../../src/browser-evidence/drivers/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outputRoot = '/tmp/vis-agent-bench-vab-t11';
const fixture = readFileSync(join(here, 'fixtures', 'index.html'));
const allowedPolicy = {
  allowed_origins: ['http://127.0.0.1:41771'],
  allowed_file_roots: [join(here, 'fixtures')],
};
let websocketUpgradeCount = 0;
let serviceWorkerScriptRequests = 0;

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
    if (new URL(request.url, 'http://127.0.0.1').pathname === '/final') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><body class="tall" style="min-height:1300px"><h1 id="final-page">Final page</h1></body>');
      return;
    }
    if (new URL(request.url, 'http://127.0.0.1').pathname === '/boundary') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><p id="boundary">pending</p><script>
        let sw = 'sw:pending';
        let ws = 'ws:pending';
        const update = () => { document.querySelector('#boundary').textContent = sw + ' ' + ws; };
        navigator.serviceWorker.register('/sw.js').then(
          registration => {
            sw = registration.active || registration.installing || registration.waiting
              ? 'sw:allowed'
              : 'sw:blocked';
            update();
          },
          () => { sw = 'sw:blocked'; update(); },
        );
        const socket = new WebSocket('ws://127.0.0.1:41771/socket');
        socket.onopen = () => { ws = 'ws:allowed'; update(); };
        socket.onerror = () => { ws = 'ws:blocked'; update(); };
        socket.onclose = () => { if (ws === 'ws:pending') ws = 'ws:blocked'; update(); };
        setTimeout(() => {
          if (sw === 'sw:pending') sw = 'sw:blocked';
          if (ws === 'ws:pending') ws = 'ws:blocked';
          update();
        }, 300);
      </script>`);
      return;
    }
    if (new URL(request.url, 'http://127.0.0.1').pathname === '/subresource') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><img id="foreign" src="http://localhost:41771/pixel.png">');
      return;
    }
    if (new URL(request.url, 'http://127.0.0.1').pathname === '/sw.js') {
      serviceWorkerScriptRequests += 1;
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end('self.addEventListener("fetch", () => {});');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.on('upgrade', (request, socket) => {
      websocketUpgradeCount += 1;
      socket.destroy();
    });
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

    const zeroTimeout = readSpec('success.smoke.json');
    zeroTimeout.default_timeout_ms = 0;
    zeroTimeout.steps[1].timeout_ms = 0;
    const invalidTimeout = validatePlaywrightSpec(zeroTimeout);
    assert.equal(invalidTimeout.valid, false);
    assert.equal(invalidTimeout.errors.filter(error => error.code === 'NUMBER_RANGE').length, 2);

    const tooManySteps = readSpec('success.smoke.json');
    tooManySteps.steps = [
      tooManySteps.steps[0],
      ...Array.from({ length: MAX_PLAYWRIGHT_STEPS }, () => ({ kind: 'wait', duration_ms: 1 })),
    ];
    const invalidSteps = validatePlaywrightSpec(tooManySteps);
    assert.equal(invalidSteps.valid, false);
    assert.ok(invalidSteps.errors.some(error => error.code === 'ARRAY_MAX'));
  });

  await check('file policy rejects host files and symlink escapes', async () => {
    const sensitiveCandidates = process.platform === 'win32'
      ? ['C:\\Windows\\System32\\drivers\\etc\\hosts']
      : ['/etc/hosts', '/private/etc/hosts'];
    const sensitive = sensitiveCandidates.find(existsSync);
    assert.ok(sensitive, 'a platform hosts file must exist for the adversarial test');

    const direct = readSpec('success.smoke.json');
    direct.steps = [{ kind: 'goto', url: pathToFileURL(sensitive).href }];
    const directResult = await createPlaywrightDriver().capture(direct, { policy: allowedPolicy });
    assert.equal(directResult.status, 'error');
    assert.ok(directResult.errors.some(error => error.code === 'POLICY_DENIED'));

    const tempRoot = mkdtempSync(join(tmpdir(), 'vab-t15-policy-'));
    try {
      const link = join(tempRoot, 'escaped-hosts');
      symlinkSync(sensitive, link);
      const escaped = readSpec('success.smoke.json');
      escaped.steps = [{ kind: 'goto', url: pathToFileURL(link).href }];
      const escapedResult = await createPlaywrightDriver().capture(escaped, {
        policy: { allowed_origins: [], allowed_file_roots: [tempRoot] },
      });
      assert.equal(escapedResult.status, 'error');
      assert.ok(escapedResult.errors.some(error => error.code === 'POLICY_DENIED'));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  await check('undeclared loopback origin is rejected exactly', async () => {
    const spec = readSpec('success.smoke.json');
    const result = await createPlaywrightDriver().capture(spec, {
      policy: {
        allowed_origins: ['http://localhost:41771'],
        allowed_file_roots: [],
      },
    });
    assert.equal(result.status, 'error');
    assert.ok(result.errors.some(error => error.code === 'POLICY_DENIED'));
  });

  await check('real local Chromium happy path emits stable evidence', async () => {
    const result = await createPlaywrightDriver().capture(readSpec('success.smoke.json'), {
      outDir: join(outputRoot, 'success'),
      policy: allowedPolicy,
    });
    assert.equal(result.status, 'success', JSON.stringify(result.errors, null, 2));
    assert.equal(result.evidence.driver, 'playwright-chromium');
    assert.match(result.evidence.environment.browser_version, /^\d+\./);
    assert.equal(result.evidence.viewport.width, 800);
    assert.ok(result.evidence.console_messages.some(entry => entry.message === 'fixture-ready'));
    assert.equal(result.evidence.screenshots.length, 1);
    assert.ok(result.evidence.screenshots[0].digest.startsWith('sha256-'));
    const png = readFileSync(join(outputRoot, 'success', 'final.png'));
    const measuredDimensions = {
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
    };
    assert.deepEqual(result.evidence.screenshots[0].dimensions, measuredDimensions);
    assert.equal(measuredDimensions.width, 800);
    assert.ok(measuredDimensions.height > 500);
    assert.equal(result.evidence.page_url, 'http://127.0.0.1:41771/final');
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
      policy: allowedPolicy,
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
    const result = await createPlaywrightDriver().capture(spec, {
      policy: {
        allowed_origins: ['http://127.0.0.1:41772'],
        allowed_file_roots: [],
      },
    });
    assert.equal(result.status, 'error');
    assert.equal(result.evidence.failures[0].code, 'LOAD_FAILED');
    assert.equal(result.evidence.failures[0].failure_class, 'navigation');
  });

  await check('browser startup failure is environment-classified', async () => {
    const load = () => {
      throw new Error('synthetic missing Playwright');
    };
    const result = await createPlaywrightDriver({ load }).capture(readSpec('success.smoke.json'), {
      policy: allowedPolicy,
    });
    assert.equal(result.status, 'error');
    assert.equal(result.evidence.failures[0].code, 'DRIVER_UNAVAILABLE');
    assert.equal(result.evidence.failures[0].failure_class, 'environment');
    assert.equal(result.evidence.action_log.length, 0);
  });

  await check('capture deadline closes real Chromium with a structured failure', async () => {
    const spec = readSpec('success.smoke.json');
    spec.capture_id = 'vab-t15-deadline';
    spec.capture_deadline_ms = 5_000;
    spec.steps = [
      spec.steps[0],
      { kind: 'wait', duration_ms: 5_000 },
    ];
    const before = Date.now();
    const result = await createPlaywrightDriver().capture(spec, {
      policy: allowedPolicy,
      outDir: join(outputRoot, 'deadline'),
    });
    assert.ok(Date.now() - before < 8_000);
    assert.equal(result.status, 'warning');
    assert.ok(result.evidence.failures.some(error => (
      error.code === 'CAPTURE_INCOMPLETE'
      && error.failure_class === 'product'
      && error.deadline_exceeded === true
    )));
  });

  await check('Service Worker and WebSocket never cross the browser boundary', async () => {
    const spec = readSpec('success.smoke.json');
    spec.capture_id = 'vab-t15-browser-boundaries';
    spec.steps = [
      { kind: 'goto', url: 'http://127.0.0.1:41771/boundary' },
      { kind: 'wait', duration_ms: 500 },
      { kind: 'assert-text', selector: '#boundary', text: 'sw:blocked ws:blocked', match: 'exact', timeout_ms: 2_000 },
    ];
    const result = await createPlaywrightDriver().capture(spec, { policy: allowedPolicy });
    assert.equal(result.status, 'success', JSON.stringify(result.errors, null, 2));
    assert.equal(websocketUpgradeCount, 0);
    assert.equal(serviceWorkerScriptRequests, 0);
    assert.ok(result.evidence.network_events.some(event => (
      event.resource_type === 'websocket' && event.blocked_by_policy === true
    )));
  });

  await check('non-allowlisted subresources are blocked by exact origin', async () => {
    const spec = readSpec('success.smoke.json');
    spec.capture_id = 'vab-t15-subresource-boundary';
    spec.steps = [
      { kind: 'goto', url: 'http://127.0.0.1:41771/subresource' },
      { kind: 'wait', duration_ms: 100 },
    ];
    const result = await createPlaywrightDriver().capture(spec, { policy: allowedPolicy });
    assert.equal(result.status, 'warning');
    assert.ok(result.evidence.network_events.some(event => (
      event.url === 'http://localhost:41771/pixel.png'
      && event.blocked_by_policy === true
    )));
    assert.ok(result.evidence.failures.some(error => error.code === 'NETWORK_FAILURE'));
  });
} finally {
  await new Promise(resolvePromise => server.close(resolvePromise));
}

const summary = {
  status: checks.length ? 'error' : 'success',
  summary: checks.length ? `${checks.length} Playwright check(s) failed.` : '10/10 Playwright checks passed.',
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
