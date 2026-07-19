import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = join(import.meta.dirname, '..', '..');
const outDir = mkdtempSync(join(tmpdir(), 'vab-smoke-flow-'));

try {
  const result = spawnSync(
    process.execPath,
    ['scripts/dev-smoke-flow.mjs', '--out-dir', outDir],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.status, 'success');

  for (const stage of ['S0', 'S1', 'S2']) {
    assert.ok(existsSync(join(outDir, 'input', `stage-${stage}.md`)));
    assert.ok(existsSync(join(outDir, 'logs', 'stages', stage, 'checkpoint.json')));
    assert.ok(existsSync(join(outDir, 'logs', 'stages', stage, 'normalized-events.jsonl')));
  }

  const runResult = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'));
  assert.equal(runResult.status, 'success');
  assert.equal(runResult.stages.length, 3);

  const report = JSON.parse(readFileSync(join(outDir, 'reports', 'report.json'), 'utf8'));
  assert.equal(report.view.demo, true);
  assert.equal(report.data_provenance.leaderboard_eligible, false);
  assert.doesNotMatch(report.leadership_summary.headline, /no delivery has been accepted/);
  assert.ok(existsSync(join(outDir, 'reports', 'report.md')));
  const html = readFileSync(join(outDir, 'reports', 'report.html'), 'utf8');
  assert.match(html, /DEMO DATA/);
  assert.match(html, /Development Smoke Flow Report/);

  process.stdout.write('development smoke flow passed\n');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
