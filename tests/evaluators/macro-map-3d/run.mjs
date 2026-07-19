import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPlaywrightDriver } from '../../../src/browser-evidence/drivers/index.mjs';
import {
  DEFAULT_CONTROL_INPUTS,
  evaluateMacroMap3d,
  validateCheckMapping,
} from '../../../src/evaluators/cases/macro-map-3d/index.mjs';
import { loadMacroMap3dRubric } from '../../../src/evaluators/cases/macro-map-3d/rubric.mjs';
import { collectBooleanPaths } from '../../../src/evaluators/control/observation-attestation.mjs';
import { createIntentionalFailure, createMinimalCompliantObservation } from './samples.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = '/tmp/vis-agent-bench-vab-t12';
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'index.html'));
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.stack });
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
  }
}

function startServer() {
  const server = createServer((request, response) => {
    if (new URL(request.url, 'http://127.0.0.1').pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(FIXTURE);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

function browserSpec(port) {
  return {
    schema_version: 1,
    capture_id: 'vab-t12-minimal-compliant-browser',
    run_id: 'vab-t12-local',
    case_id: 'macro-map-3d-greenfield',
    viewport: { width: 960, height: 640 },
    steps: [
      { kind: 'goto', label: 'open', url: `http://127.0.0.1:${port}/` },
      { kind: 'wait', selector: '#scene', state: 'visible' },
      { kind: 'hover', selector: '#scene' },
      { kind: 'assert-visible', selector: '#tooltip' },
      { kind: 'click', selector: '#select-node' },
      { kind: 'assert-text', selector: '#selection', text: 'factor-core-001', match: 'exact' },
      { kind: 'click', selector: '#view-mode' },
      { kind: 'assert-text', selector: '#view-mode', text: 'relation-2d', match: 'exact' },
      { kind: 'resize', width: 800, height: 560 },
      { kind: 'collect-state', label: 'macro-final-state', selectors: ['#scene', '#tooltip', '#selection', '#view-mode'] },
      { kind: 'screenshot', label: 'macro-final' },
    ],
  };
}

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
const server = await startServer();
let browser;
try {
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const capture = await createPlaywrightDriver().capture(browserSpec(address.port), {
    outDir: join(OUTPUT_ROOT, 'browser'),
    policy: { allowed_origins: [origin], allowed_file_roots: [] },
  });
  assert.equal(capture.status, 'success', JSON.stringify(capture.errors, null, 2));
  browser = capture.evidence;
} finally {
  await new Promise(resolvePromise => server.close(resolvePromise));
}

await test('rubric IDs, hard gates, and assertions are one-to-one', () => {
  const mapping = validateCheckMapping(loadMacroMap3dRubric());
  assert.equal(mapping.declared.length, 30);
  assert.equal(new Set(mapping.declared).size, 30);
  assert.equal(mapping.hardGates.length, 7);
  assert.ok(mapping.hardGates.every(id => mapping.declared.includes(id)));
});

await test('control inputs include all scale, boundary, and hidden invalid fixtures', () => {
  assert.deepEqual(Object.keys(DEFAULT_CONTROL_INPUTS).sort(), [
    'boundary', 'graph1481', 'graph200', 'graph800', 'invalid',
  ]);
  assert.ok(Object.values(DEFAULT_CONTROL_INPUTS).every(existsSync));
  assert.match(DEFAULT_CONTROL_INPUTS.invalid, /fixture\/control\/invalid-inputs\.json$/);
});

await test('minimal compliant sample uses real Chromium evidence and passes all checks', async () => {
  assert.equal(browser.driver, 'playwright-chromium');
  assert.match(browser.environment.browser_version, /^\d+\./);
  assert.equal(browser.canvas_webgl_proven, false);
  const evaluation = await evaluateMacroMap3d({
    observation: asTestDouble(createMinimalCompliantObservation(structuredClone(browser))),
    runId: 'minimal-compliant',
    allowTestDouble: true,
  });
  assert.equal(evaluation.status, 'success');
  assert.equal(evaluation.scorecard.total, 100);
  assert.equal(evaluation.bundle.results.length, 30);
  assert.deepEqual([...new Set(evaluation.bundle.results.map(item => item.status))], ['pass']);
  assert.match(evaluation.bundle.notes, /do not prove aesthetics or WebGL correctness/);
  assert.equal(evaluation.bundle.evidence_trust.conclusion_eligible, false);
});

await test('Canvas check reports observation-only proof and never claims WebGL correctness', async () => {
  const evaluation = await evaluateMacroMap3d({
    observation: asTestDouble(createMinimalCompliantObservation(structuredClone(browser))),
    runId: 'canvas-proof-boundary',
    allowTestDouble: true,
  });
  const canvas = evaluation.bundle.results
    .find(item => item.check_id === 'browser-canvas-observable-state');
  assert.equal(canvas.status, 'pass');
  assert.equal(canvas.evidence.details.canvas_webgl_proven, false);
  assert.match(canvas.evidence.details.claim, /not visual or WebGL correctness/);
});

await test('intentionally wrong sample fails critical deterministic checks', async () => {
  const evaluation = await evaluateMacroMap3d({
    observation: asTestDouble(createIntentionalFailure(structuredClone(browser))),
    runId: 'intentional-failure',
    allowTestDouble: true,
  });
  const failed = new Set(evaluation.bundle.results
    .filter(item => item.status === 'fail')
    .map(item => item.check_id));
  for (const id of [
    'build-and-test',
    'input-validation',
    'scale-ladder-data-completeness',
    'deterministic-layer-layout',
    'browser-runtime-clean',
    'performance-budget-and-stats',
    'context-loss-and-degradation',
    'repeated-mount-dispose-cleanup',
  ]) {
    assert.ok(failed.has(id), `${id} should fail`);
  }
  assert.equal(evaluation.status, 'error');
  assert.equal(evaluation.scorecard.total, 0);
  assert.ok(evaluation.scorecard.hard_gates.failing.length >= 6);
});

await test('observation can be supplied by JSON path', async () => {
  const samplePath = join(OUTPUT_ROOT, 'observation-path.json');
  const payload = JSON.stringify(asTestDouble(createMinimalCompliantObservation(structuredClone(browser))));
  writeFileSync(samplePath, payload);
  const evaluation = await evaluateMacroMap3d({
    observationPath: samplePath,
    runId: 'path-input',
    allowTestDouble: true,
  });
  assert.equal(evaluation.status, 'success');
});

await test('production mode rejects bare observation and arbitrary observationPath', async () => {
  await assert.rejects(
    () => evaluateMacroMap3d({
      observation: asTestDouble(createMinimalCompliantObservation(structuredClone(browser))),
      runId: 'bare',
    }),
    /reject bare observation/,
  );
  await assert.rejects(
    () => evaluateMacroMap3d({ observationPath: '/tmp/arbitrary.json', runId: 'bare-path' }),
    /reject bare observation/,
  );
});

const summary = {
  status: failures.length ? 'error' : 'success',
  summary: failures.length
    ? `${failures.length} Macro Map 3D evaluator test(s) failed.`
    : '7/7 Macro Map 3D evaluator tests passed.',
  next_actions: failures.length ? ['Fix the listed evaluator failures.'] : [],
  artifacts: [
    join(OUTPUT_ROOT, 'browser', 'browser-evidence.json'),
    join(OUTPUT_ROOT, 'browser', 'macro-final.png'),
  ],
  not_proven: [
    'spatial hierarchy aesthetics',
    'camera comfort',
    'animation feel',
    'label aesthetics',
    'WebGL correctness from Canvas signatures',
  ],
  ...(failures.length ? { failures } : {}),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length) process.exitCode = 1;

function asTestDouble(observation) {
  const output = structuredClone(observation);
  output.provenance = {
    boolean_facts: Object.fromEntries(collectBooleanPaths(output).map(path => [
      path,
      [{ source: 'test_double', conclusion_eligible: false }],
    ])),
  };
  return output;
}
