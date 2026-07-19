import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateGraphData } from '../../../cases/macro-map-3d-greenfield/fixture/starter/src/data-contract.js';
import { validateRuntimeOptions } from '../../../cases/macro-map-3d-greenfield/fixture/starter/src/scene-adapter.js';

const root = resolve(import.meta.dirname, '../../..');
const fixture = join(root, 'cases/macro-map-3d-greenfield/fixture');
const starter = join(fixture, 'starter');
const output = mkdtempSync(join(tmpdir(), 'vab-t09-export-'));
const graphPath = join(starter, 'data/public/graph-1481.json');
const before = createHash('sha256').update(readFileSync(graphPath)).digest('hex');

try {
  execFileSync(process.execPath, ['scripts/fixtures/macro-map-3d/generate-fixture.mjs'], { cwd: root, stdio: 'pipe' });
  const after = createHash('sha256').update(readFileSync(graphPath)).digest('hex');
  assert.equal(after, before, 'generator output must be byte-stable');

  execFileSync(process.execPath, ['scripts/fixtures/macro-map-3d/verify-fixture.mjs'], { cwd: root, stdio: 'pipe' });
  execFileSync(process.execPath, [
    'scripts/build-fixture.mjs',
    '--case', 'macro-map-3d-greenfield',
    '--source-root', starter,
    '--export-root', output,
  ], { cwd: root, stdio: 'pipe' });

  const manifest = JSON.parse(readFileSync(join(output, '.fixture/manifest.json'), 'utf8'));
  assert.equal(manifest.source_type, 'synthetic');
  assert.deepEqual(manifest.leakage.finding_counts, { path: 0, content: 0, canary: 0 });
  assert.equal(manifest.baseline.status, 'passed');
  assert.deepEqual(manifest.baseline.steps.map((step) => step.type), ['build', 'typecheck', 'test']);
  assert.ok(manifest.baseline.steps.every((step) => step.status === 'passed'));
  assert.ok(manifest.files.some((entry) => entry.file === 'data/public/graph-1481.json'));
  assert.ok(manifest.files.some((entry) => entry.file === 'public/assets/generated-grid.svg'));
  assert.ok(manifest.files.some((entry) => entry.file === 'dist/index.html'));
  assert.ok(manifest.files.every((entry) => !entry.file.startsWith('control/')));
  assert.ok(manifest.files.every((entry) => !/provenance|acceptance|rubric/i.test(entry.file)));

  const base = JSON.parse(readFileSync(join(starter, 'data/public/boundary-valid.json'), 'utf8'));
  const controls = JSON.parse(readFileSync(join(fixture, 'control/invalid-inputs.json'), 'utf8'));
  for (const control of controls.cases) {
    if (control.runtime) {
      const result = validateRuntimeOptions({
        theme: 'light',
        language: 'en',
        viewMode: 'sphere-3d',
        relationStrategy: 'always',
        visibleOffset: { top: 0, right: 0, bottom: 0, left: 0 },
        ...control.runtime,
      });
      assert.equal(result.status, 'error', control.id);
      assert.ok(result.details.includes(control.expected_error), control.id);
      continue;
    }
    const value = structuredClone(base);
    applyControlPatch(value, control.patch);
    const result = validateGraphData(value);
    assert.equal(result.status, 'error', control.id);
    assert.ok(result.details.includes(control.expected_error), `${control.id}: ${JSON.stringify(result.details)}`);
  }

  console.log(JSON.stringify({
    status: 'success',
    summary: 'VAB-T09 fixture generation, baseline, isolation, and zero-leakage checks passed.',
    next_actions: [],
    artifacts: [join(output, '.fixture/manifest.json')],
  }));
} finally {
  rmSync(output, { recursive: true, force: true });
}

function applyControlPatch(value, patch) {
  const parsePath = (path) => path.replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1').split('.');
  const targetPath = parsePath(patch.path);
  const sourcePath = patch.value_from ? parsePath(patch.value_from) : null;
  let target = value;
  for (const segment of targetPath.slice(0, -1)) target = target[segment];
  let replacement = patch.value;
  if (sourcePath) {
    replacement = value;
    for (const segment of sourcePath) replacement = replacement[segment];
  }
  target[targetPath.at(-1)] = replacement;
}
