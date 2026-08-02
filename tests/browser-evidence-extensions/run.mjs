// ROADMAP M3 browser-evidence extension tests.
//
// Covers:
//   1. webgl-inspector.assertWebGLSemantic pass/fail on synthetic facts.
//   2. screenshot-diff.compareScreenshots on identical, different, and
//      threshold-boundary images (synthesized PNGs, no fixtures required).
//   3. perf-collector.assertPerformance pass/fail on synthetic facts.
//   4. capture-spec accepts the new webglInspect / perfMeasure action kinds.
//   5. macro-map-3d evaluator wiring: the three new checks pass when their
//      observation fields are absent and run when present.
//   6. Optional real-browser probe: if Playwright + Chromium are available,
//      extract real WebGL facts and a perf sample from a tiny page; otherwise
//      warn and skip without failing.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { assertWebGLSemantic } from '../../src/browser-evidence/webgl-inspector.mjs';
import { compareScreenshots, loadBaseline } from '../../src/browser-evidence/screenshot-diff.mjs';
import { assertPerformance } from '../../src/browser-evidence/perf-collector.mjs';
import { validateCaptureSpec } from '../../src/browser-evidence/index.mjs';
import {
  validatePlaywrightSpec,
} from '../../src/browser-evidence/drivers/index.mjs';
import { evaluateMacroMap3d } from '../../src/evaluators/cases/macro-map-3d/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.stack });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  }
}

function makePng(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < stride; x += 3) {
      raw[y * (stride + 1) + 1 + x] = rgb[0];
      raw[y * (stride + 1) + 1 + x + 1] = rgb[1];
      raw[y * (stride + 1) + 1 + x + 2] = rgb[2];
    }
  }
  return encodePng(w, h, deflateSync(raw));
}

function makeGradientPng(w, h, fn) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = fn(x, y);
      raw[y * (stride + 1) + 1 + x * 3] = r;
      raw[y * (stride + 1) + 1 + x * 3 + 1] = g;
      raw[y * (stride + 1) + 1 + x * 3 + 2] = b;
    }
  }
  return encodePng(w, h, deflateSync(raw));
}

function encodePng(w, h, idat) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  function crc32(buf) {
    let crc = ~0;
    for (const byte of buf) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (~crc) >>> 0;
  }
  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const l = Buffer.alloc(4);
    l.writeUInt32BE(data.length, 0);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([l, t, data, c]);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 1. webgl-inspector.assertWebGLSemantic ----------

await check('assertWebGLSemantic passes a healthy synthetic facts set', () => {
  const facts = {
    status: 'ok',
    canvas_count: 1,
    webgl_available: true,
    webgl2_available: true,
    any_context_lost: false,
    canvases: [{
      has_webgl: true,
      has_webgl2: true,
      context_lost: false,
      renderer: 'ANGLE (NVIDIA GeForce RTX 3080)',
      vendor: 'Google Inc.',
      max_texture_size: 16384,
      drawing_buffer_width: 1280,
      drawing_buffer_height: 800,
      active_program: 1,
    }],
  };
  const verdict = assertWebGLSemantic(facts, {
    min_canvas_count: 1,
    require_webgl: true,
    context_lost: false,
    renderer_includes: 'ANGLE',
    min_max_texture_size: 1024,
    min_active_programs: 1,
  });
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.reason, null);
});

await check('assertWebGLSemantic fails when context_lost is true', () => {
  const facts = {
    status: 'ok',
    canvas_count: 1,
    webgl_available: true,
    webgl2_available: false,
    any_context_lost: true,
    canvases: [{
      has_webgl: true,
      context_lost: true,
      renderer: 'SwiftShader',
      max_texture_size: 4096,
      drawing_buffer_width: 1280,
      drawing_buffer_height: 800,
      active_program: 0,
    }],
  };
  const verdict = assertWebGLSemantic(facts, { context_lost: false, renderer_includes: 'ANGLE' });
  assert.equal(verdict.status, 'fail');
  const failureFields = verdict.evidence.failures.map(f => f.field).sort();
  assert.ok(failureFields.includes('context_lost'));
  assert.ok(failureFields.includes('renderer_includes'));
});

await check('assertWebGLSemantic mirrors skip status when facts skipped', () => {
  const facts = { status: 'skip', reason: 'page_unavailable', root_cause_hint: 'no browser' };
  const verdict = assertWebGLSemantic(facts, { require_webgl: true });
  assert.equal(verdict.status, 'skip');
  assert.equal(verdict.reason, 'page_unavailable');
});

await check('assertWebGLSemantic fails on missing active programs', () => {
  const facts = {
    status: 'ok',
    canvas_count: 1,
    webgl_available: true,
    webgl2_available: false,
    any_context_lost: false,
    canvases: [{
      has_webgl: true,
      context_lost: false,
      renderer: 'ANGLE',
      max_texture_size: 16384,
      drawing_buffer_width: 1280,
      drawing_buffer_height: 800,
      active_program: 0,
    }],
  };
  const verdict = assertWebGLSemantic(facts, { min_active_programs: 1 });
  assert.equal(verdict.status, 'fail');
  assert.equal(verdict.evidence.failures[0].field, 'min_active_programs');
});

// ---------- 2. screenshot-diff.compareScreenshots ----------

await check('compareScreenshots pixel mode matches identical images', () => {
  const red = makePng(8, 8, [255, 0, 0]);
  const verdict = compareScreenshots(red, red, { threshold: 0 });
  assert.equal(verdict.status, 'match');
  assert.equal(verdict.mismatch_ratio, 0);
});

await check('compareScreenshots pixel mode flags fully different images', () => {
  const red = makePng(8, 8, [255, 0, 0]);
  const blue = makePng(8, 8, [0, 0, 255]);
  const verdict = compareScreenshots(red, blue, { threshold: 0 });
  assert.equal(verdict.status, 'mismatch');
  assert.equal(verdict.mismatch_ratio, 1);
});

await check('compareScreenshots threshold boundary returns match', () => {
  const red = makePng(8, 8, [255, 0, 0]);
  const blue = makePng(8, 8, [0, 0, 255]);
  // 100% mismatch but threshold above 1.0 -> match.
  const verdict = compareScreenshots(red, blue, { threshold: 1.5 });
  assert.equal(verdict.status, 'match');
});

await check('compareScreenshots perceptual mode matches identical images', () => {
  const gradient = makeGradientPng(32, 32, (x, y) => [(x * 8) & 255, (y * 8) & 255, 128]);
  const verdict = compareScreenshots(gradient, gradient, { threshold: 0, perceptual: true });
  assert.equal(verdict.status, 'match');
});

await check('compareScreenshots perceptual mode flags block-level difference', () => {
  const red = makePng(32, 32, [255, 0, 0]);
  const blue = makePng(32, 32, [0, 0, 255]);
  const verdict = compareScreenshots(red, blue, { threshold: 0, perceptual: true, pixel_threshold: 25 });
  assert.equal(verdict.status, 'mismatch');
  assert.ok(verdict.mismatch_ratio > 0);
});

await check('compareScreenshots handles dimension mismatch in pixel mode', () => {
  const small = makePng(4, 4, [0, 0, 0]);
  const large = makePng(8, 8, [0, 0, 0]);
  const verdict = compareScreenshots(small, large, { threshold: 0 });
  assert.equal(verdict.status, 'mismatch');
  assert.equal(verdict.reason, 'dimensions_differ');
});

await check('compareScreenshots writes a diff artifact when diffPath is set', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vab-m3-diff-'));
  try {
    const diffPath = join(tmp, 'diff.json');
    const red = makePng(16, 16, [255, 0, 0]);
    const blue = makePng(16, 16, [0, 0, 255]);
    const verdict = compareScreenshots(red, blue, { threshold: 0, perceptual: true, diffPath });
    assert.equal(verdict.status, 'mismatch');
    assert.equal(existsSync(diffPath), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await check('compareScreenshots returns skip when image is unreadable', () => {
  const verdict = compareScreenshots(Buffer.from('not-a-png'), Buffer.from('also-not'), { threshold: 0 });
  assert.equal(verdict.status, 'skip');
  assert.equal(verdict.reason, 'image_unreadable');
});

await check('loadBaseline returns skip when baseline is missing', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vab-m3-baseline-'));
  try {
    const result = loadBaseline(tmp, 'nonexistent');
    assert.equal(result.status, 'skip');
    assert.equal(result.reason, 'baseline_missing');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await check('loadBaseline loads a baseline file when present', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vab-m3-baseline-load-'));
  try {
    const baselineDir = join(tmp, 'evaluator', 'baselines');
    const baselinePath = join(baselineDir, 'sample.png');
    const buffer = makePng(8, 8, [10, 20, 30]);
    mkdirSync(baselineDir, { recursive: true });
    writeFileSync(baselinePath, buffer);
    const result = loadBaseline(tmp, 'sample');
    assert.equal(result.status, 'ok');
    assert.ok(Buffer.isBuffer(result.buffer));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- 3. perf-collector.assertPerformance ----------

await check('assertPerformance passes a healthy synthetic sample', () => {
  const facts = {
    status: 'ok',
    fps: 55,
    p95_frame_ms: 30,
    memory: { used_js_heap_mb: 80, total_js_heap_mb: 120, js_heap_size_limit_mb: 2048 },
    longtask_count: 1,
    max_longtask_ms: 60,
  };
  const verdict = assertPerformance(facts, { min_fps: 30, max_p95_frame_ms: 50, max_heap_mb: 512, max_longtask_ms: 100 });
  assert.equal(verdict.status, 'pass');
});

await check('assertPerformance fails on low FPS', () => {
  const facts = {
    status: 'ok',
    fps: 15,
    p95_frame_ms: 80,
    memory: { used_js_heap_mb: 80, total_js_heap_mb: 120, js_heap_size_limit_mb: 2048 },
    longtask_count: 1,
    max_longtask_ms: 60,
  };
  const verdict = assertPerformance(facts, { min_fps: 30, max_p95_frame_ms: 50, max_longtask_ms: 100 });
  assert.equal(verdict.status, 'fail');
  const fields = verdict.evidence.failures.map(f => f.field).sort();
  assert.deepEqual(fields, ['max_p95_frame_ms', 'min_fps']);
});

await check('assertPerformance fails on heap oversize', () => {
  const facts = {
    status: 'ok',
    fps: 60,
    p95_frame_ms: 16,
    memory: { used_js_heap_mb: 800, total_js_heap_mb: 900, js_heap_size_limit_mb: 2048 },
    longtask_count: 0,
    max_longtask_ms: 0,
  };
  const verdict = assertPerformance(facts, { max_heap_mb: 512 });
  assert.equal(verdict.status, 'fail');
  assert.equal(verdict.evidence.failures[0].field, 'max_heap_mb');
});

await check('assertPerformance mirrors skip when facts skipped', () => {
  const verdict = assertPerformance(
    { status: 'skip', reason: 'page_unavailable' },
    { min_fps: 30 },
  );
  assert.equal(verdict.status, 'skip');
});

// ---------- 4. capture-spec / playwright-spec extension ----------

await check('capture spec accepts webglInspect action', () => {
  const spec = {
    capture_id: 'm3-cs-1',
    run_id: 'm3-cs-1',
    case_id: 'macro-map-3d-greenfield',
    fixture_dir: 'tests/browser-evidence/fixtures/dashboard',
    actions: [{ kind: 'webglInspect', label: 'webgl-probe' }],
  };
  const result = validateCaptureSpec(spec, { root: resolve(HERE, '..') });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.spec.actions[0].kind, 'webglInspect');
});

await check('capture spec accepts perfMeasure action with sample_ms', () => {
  const spec = {
    capture_id: 'm3-cs-2',
    run_id: 'm3-cs-2',
    case_id: 'macro-map-3d-greenfield',
    fixture_dir: 'tests/browser-evidence/fixtures/dashboard',
    actions: [{ kind: 'perfMeasure', label: 'perf-probe', sample_ms: 500 }],
  };
  const result = validateCaptureSpec(spec, { root: resolve(HERE, '..') });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

await check('playwright spec accepts webgl-inspect and perf-measure steps', () => {
  const spec = {
    schema_version: 1,
    capture_id: 'm3-pw-1',
    run_id: 'm3-pw-1',
    case_id: 'macro-map-3d-greenfield',
    viewport: { width: 800, height: 600 },
    steps: [
      { kind: 'goto', url: 'http://127.0.0.1:1/' },
      { kind: 'webgl-inspect', label: 'probe', sample_ms: 100 },
      { kind: 'perf-measure', label: 'sample', sample_ms: 1000 },
    ],
  };
  const result = validatePlaywrightSpec(spec);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

// ---------- 5. macro-map-3d evaluator wiring ----------

await check('macro-map-3d new checks pass when observation fields absent', async () => {
  const { createMinimalCompliantObservation } = await import(
    '../evaluators/macro-map-3d/samples.mjs'
  );
  const browser = {
    driver: 'playwright-chromium',
    status: 'success',
    environment: { playwright_source: 'project-module', chromium_source: 'playwright-package', browser_version: '120.0' },
    wait: { kind: 'declarative-steps' },
    action_log: [{ kind: 'goto', label: 'open', status: 'passed' }],
    dom_snapshots: [{
      label: 'snapshot',
      summary: {
        canvases: [{
          width: 800, height: 600,
          css_width: 800, css_height: 600,
          drawing_non_empty: true, encoded_length: 200,
        }],
      },
    }],
    screenshots: [{ label: 's0', kind: 'png', path: '/nonexistent/shot.png' }],
    canvas_webgl_proven: false,
    console_errors: [],
    page_errors: [],
    network_events: [],
    failures: [],
  };
  const observation = createMinimalCompliantObservation(browser);
  const evaluation = await evaluateMacroMap3d({
    observation: await asTestDoubleAsync(observation),
    runId: 'm3-evaluator-absent',
    allowTestDouble: true,
  });
  for (const id of ['webgl-semantic-correctness', 'visual-baseline-diff', 'performance-budget']) {
    const item = evaluation.bundle.results.find(entry => entry.check_id === id);
    assert.ok(item, `missing check ${id}`);
    assert.equal(item.status, 'pass', `${id} should pass when field is absent`);
  }
  assert.equal(evaluation.status, 'success');
  assert.equal(evaluation.scorecard.total, 100);
});

await check('macro-map-3d webgl check fails when context_lost in observation', async () => {
  const { createMinimalCompliantObservation } = await import(
    '../evaluators/macro-map-3d/samples.mjs'
  );
  const browser = {
    driver: 'playwright-chromium',
    status: 'success',
    environment: { playwright_source: 'project-module', chromium_source: 'playwright-package', browser_version: '120.0' },
    wait: { kind: 'declarative-steps' },
    action_log: [{ kind: 'goto', label: 'open', status: 'passed' }],
    dom_snapshots: [{
      label: 'snapshot',
      summary: {
        canvases: [{
          width: 800, height: 600,
          css_width: 800, css_height: 600,
          drawing_non_empty: true, encoded_length: 200,
        }],
      },
    }],
    screenshots: [{ label: 's0', kind: 'png', path: '/nonexistent/shot.png' }],
    canvas_webgl_proven: false,
    console_errors: [],
    page_errors: [],
    network_events: [],
    failures: [],
  };
  const observation = createMinimalCompliantObservation(browser);
  observation.webgl = {
    status: 'ok',
    canvas_count: 1,
    webgl_available: true,
    webgl2_available: false,
    any_context_lost: true,
    canvases: [{
      has_webgl: true,
      has_webgl2: false,
      context_lost: true,
      renderer: 'SwiftShader',
      max_texture_size: 4096,
      drawing_buffer_width: 800,
      drawing_buffer_height: 600,
      active_program: 0,
    }],
  };
  const evaluation = await evaluateMacroMap3d({
    observation: await asTestDoubleAsync(observation),
    runId: 'm3-evaluator-webgl-fail',
    allowTestDouble: true,
  });
  const webgl = evaluation.bundle.results.find(item => item.check_id === 'webgl-semantic-correctness');
  assert.equal(webgl.status, 'fail');
});

// ---------- 6. Optional real-browser probe ----------

let playwrightAvailable = false;
let driverFactory = null;
try {
  const mod = await import('../../src/browser-evidence/drivers/index.mjs');
  driverFactory = mod.createPlaywrightDriver;
  // Probe whether playwright actually loads without forcing a browser launch.
  const loader = await import('../../src/browser-evidence/drivers/playwright-loader.mjs');
  loader.loadPlaywright();
  playwrightAvailable = true;
} catch (error) {
  process.stderr.write(`WARN real-browser probe skipped: ${error.message}\n`);
}

if (playwrightAvailable && driverFactory) {
  await check('real Chromium: extractWebGLFacts + collectPerformance return structured facts', async () => {
    const { extractWebGLFacts } = await import('../../src/browser-evidence/webgl-inspector.mjs');
    const { collectPerformance } = await import('../../src/browser-evidence/perf-collector.mjs');
    // Use a temp file:// URL instead of data: to satisfy the playwright LOCAL_URL_ONLY policy.
    const tmpDir = mkdtempSync(join(tmpdir(), 'vab-m3-real-'));
    const html = `<!doctype html><html><body><canvas id="c" width="200" height="150"></canvas><script>
      const c = document.getElementById('c');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      window.__gl = gl;
      if (gl) {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
        gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, 'void main(){gl_FragColor=vec4(0.5,0.5,0.5,1.0);}');
        gl.compileShader(fs);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.useProgram(prog);
        gl.clearColor(0.2, 0.4, 0.6, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    </script></body></html>`;
    const htmlPath = join(tmpDir, 'index.html');
    writeFileSync(htmlPath, html, 'utf8');
    const spec = {
      schema_version: 1,
      capture_id: 'm3-real-webgl',
      run_id: 'm3-real-webgl',
      case_id: 'browser-evidence-ext',
      viewport: { width: 400, height: 300 },
      steps: [
        { kind: 'goto', url: `file://${htmlPath}` },
        { kind: 'wait', duration_ms: 100 },
        { kind: 'webgl-inspect', label: 'webgl' },
        { kind: 'perf-measure', label: 'perf', sample_ms: 500 },
      ],
    };
    try {
      const result = await driverFactory().capture(spec, {
        policy: { allowed_origins: [], allowed_file_roots: [tmpDir] },
      });
      assert.equal(result.status, 'success', JSON.stringify(result.errors));
      assert.ok(result.evidence.webgl_facts.length >= 1, 'expected at least one webgl facts entry');
      const webglFacts = result.evidence.webgl_facts[0].facts;
      assert.equal(webglFacts.status, 'ok');
      assert.ok(webglFacts.canvas_count >= 1);
      assert.ok(webglFacts.canvases.length >= 1);
      assert.ok(result.evidence.perf_facts.length >= 1, 'expected at least one perf facts entry');
      const perfFacts = result.evidence.perf_facts[0].facts;
      assert.ok(perfFacts.sample_ms > 0);
    } catch (error) {
      if (error.message?.includes('DRIVER_UNAVAILABLE') || error.message?.includes('browserType.launch')) {
        // Browser launch failed (e.g. sandboxed CI); skip gracefully instead of failing.
        console.warn('WARN real-browser probe skipped: browser could not launch in this environment');
        return;
      }
      throw error;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
} else {
  await check('real-browser probe is gracefully skipped when Playwright is unavailable', () => {
    // Informational assertion so the suite stays green on minimal envs.
    assert.equal(playwrightAvailable, false);
  });
}

function asTestDouble(observation) {
  return asTestDoubleAsync(observation);
}

async function asTestDoubleAsync(observation) {
  const { collectBooleanPaths } = await import(
    '../../src/evaluators/control/observation-attestation.mjs'
  );
  const output = structuredClone(observation);
  output.provenance = {
    boolean_facts: Object.fromEntries(collectBooleanPaths(output).map(path => [
      path,
      [{ source: 'test_double', conclusion_eligible: false }],
    ])),
  };
  return output;
}

// ---------- Summary ----------

const summary = {
  status: failures.length ? 'error' : 'success',
  summary: failures.length
    ? `${failures.length} browser-evidence-extensions check(s) failed.`
    : 'browser-evidence-extensions checks passed.',
  next_actions: failures.length ? ['Fix the listed extension failures.'] : [],
  artifacts: ['tests/browser-evidence-extensions/run.mjs'],
  ...(failures.length ? { failures } : {}),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
