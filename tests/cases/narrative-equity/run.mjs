import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const starter = join(root, 'cases/narrative-equity-relationship/fixture/starter');
const control = join(root, 'cases/narrative-equity-relationship/fixture/control');
const output = mkdtempSync(join(tmpdir(), 'vab-t03-export-'));

try {
  execFileSync(process.execPath, [
    'scripts/build-fixture.mjs', '--case', 'narrative-equity-relationship',
    '--source-root', starter, '--export-root', output,
  ], { cwd: root, stdio: 'pipe' });
  const manifest = JSON.parse(readFileSync(join(output, '.fixture/manifest.json'), 'utf8'));
  assert.equal(manifest.source_type, 'synthetic');
  assert.deepEqual(manifest.leakage.finding_counts, { path: 0, content: 0, canary: 0 });
  assert.ok(manifest.files.every(entry => !entry.file.startsWith('control/')));
  assert.ok(manifest.files.some(entry => entry.file === 'public/assets/generated-tone.wav'));
  assert.ok(existsSync(join(output, 'dist/index.html')));
  assert.equal(existsSync(join(output, 'data/private')), false);
  console.log('VAB-T03 fixture export checks passed.');
} finally {
  rmSync(output, { recursive: true, force: true });
}
