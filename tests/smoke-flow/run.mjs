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
  assert.doesNotMatch(report.leadership_summary.headline, /尚无交付通过验收/);
  assert.ok(existsSync(join(outDir, 'reports', 'report.md')));
  const html = readFileSync(join(outDir, 'reports', 'report.html'), 'utf8');
  assert.match(html, /演示数据/);
  assert.match(html, /开发流程 Smoke 报告/);

  const dryRun = spawnSync(
    process.execPath,
    [
      'scripts/real-model-smoke-flow.mjs',
      '--case', 'narrative-equity-relationship',
      '--model', 'deepseek-v4-flash',
      '--max-stage-cost-usd', '2',
      '--dry-run',
    ],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  const dryRunEnvelope = JSON.parse(dryRun.stdout);
  assert.equal(dryRunEnvelope.status, 'success');
  assert.equal(dryRunEnvelope.resolved_config.case_id, 'narrative-equity-relationship');
  assert.equal(dryRunEnvelope.resolved_config.stage_count, 6);
  assert.equal(dryRunEnvelope.resolved_config.business_acceptance_requires_human_review, true);
  assert.match(dryRunEnvelope.resolved_config.workspace_source, /fixture\/starter$/);

  process.stdout.write('development smoke flow passed\n');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
