import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectReportedUsage, readProgress } from '../../scripts/real-model-smoke-flow.mjs';

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

  const statusResult = spawnSync(
    process.execPath,
    ['scripts/bench-status.mjs', '--run', outDir],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
  assert.equal(statusResult.status, 0, statusResult.stderr || statusResult.stdout);
  assert.match(statusResult.stdout, /状态：success/);
  assert.match(statusResult.stdout, /独立工作区：/);
  assert.match(statusResult.stdout, /已完成 3\/3/);

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

  const kimiDryRun = spawnSync(
    process.execPath,
    [
      'scripts/real-model-smoke-flow.mjs',
      '--case', 'narrative-equity-relationship',
      '--engine', 'kimi',
      '--model', 'kimi-code/k3',
      '--dry-run',
    ],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
  assert.equal(kimiDryRun.status, 0, kimiDryRun.stderr || kimiDryRun.stdout);
  const kimiEnvelope = JSON.parse(kimiDryRun.stdout);
  assert.equal(kimiEnvelope.resolved_config.model, 'kimi-code/k3');
  assert.equal(kimiEnvelope.resolved_config.provider, 'kimi-code-managed-provider');
  assert.equal(kimiEnvelope.resolved_config.cost_cap_enforcement, 'unavailable');
  assert.equal(kimiEnvelope.resolved_config.permission_mode, 'prompt-mode-auto');

  const codexDryRun = spawnSync(
    process.execPath,
    [
      'scripts/real-model-smoke-flow.mjs',
      '--case', 'narrative-equity-relationship',
      '--engine', 'codex',
      '--model', 'gpt-5.6-sol',
      '--reasoning-effort', 'medium',
      '--dry-run',
    ],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
  assert.equal(codexDryRun.status, 0, codexDryRun.stderr || codexDryRun.stdout);
  const codexEnvelope = JSON.parse(codexDryRun.stdout);
  assert.equal(codexEnvelope.resolved_config.model, 'gpt-5.6-sol');
  assert.equal(codexEnvelope.resolved_config.reasoning_effort, 'medium');
  assert.equal(codexEnvelope.resolved_config.provider, 'openai-codex-configured-provider');
  assert.equal(codexEnvelope.resolved_config.permission_mode, 'exec-noninteractive-workspace-write');

  const piDryRun = spawnSync(
    process.execPath,
    [
      'scripts/real-model-smoke-flow.mjs',
      '--case', 'narrative-equity-relationship',
      '--engine', 'pi',
      '--model', 'deepseek-chat',
      '--model-provider', 'deepseek',
      '--dry-run',
    ],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
  assert.equal(piDryRun.status, 0, piDryRun.stderr || piDryRun.stdout);
  const piEnvelope = JSON.parse(piDryRun.stdout);
  assert.equal(piEnvelope.resolved_config.model, 'deepseek-chat');
  assert.equal(piEnvelope.resolved_config.model_provider, 'deepseek');
  assert.equal(piEnvelope.resolved_config.provider, 'pi-direct-api');
  assert.equal(piEnvelope.resolved_config.cost_cap_enforcement, 'unavailable');
  assert.equal(piEnvelope.resolved_config.permission_mode, 'approve-restricted-tools');

  const help = spawnSync(
    process.execPath,
    ['scripts/real-model-smoke-flow.mjs', '--help'],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.equal(JSON.parse(help.stdout).status, 'success');

  const observedRun = join(outDir, 'observed-run');
  const observedCase = join(outDir, 'observed-case');
  mkdirSync(join(observedRun, 'logs', 'stages', 'S0', 'attempt-01'), { recursive: true });
  mkdirSync(join(observedCase, 'scenario'), { recursive: true });
  writeFileSync(join(observedRun, 'run-spec.json'), JSON.stringify({
    status: 'prepared',
    scenario: { stage_ids: ['S0'] },
  }));
  writeFileSync(join(observedRun, 'run-state.json'), JSON.stringify({
    status: 'running',
    scenario: { current_stage: 'S0', completed_stages: [], attempts: { S0: 1 } },
  }));
  writeFileSync(join(observedRun, 'result.json'), JSON.stringify({
    engine: { observed_models: [] },
    stages: [],
  }));
  writeFileSync(join(observedCase, 'scenario', 'stages.yaml'), 'stages:\n  - id: S0\n');
  writeFileSync(
    join(observedRun, 'logs', 'stages', 'S0', 'attempt-01', 'stdout.raw'),
    `${JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 },
    })}\n`,
  );
  const progress = readProgress(observedRun);
  assert.equal(progress.status, 'running');
  assert.equal(progress.stage_id, 'S0');
  assert.ok(progress.stdout_bytes > 0);
  const usage = collectReportedUsage(observedRun, observedCase);
  assert.equal(usage.input_tokens, 100);
  assert.equal(usage.output_tokens, 10);
  assert.equal(usage.cached_tokens, 80);
  assert.equal(usage.cost_usd, null);
  assert.equal(usage.cost_availability, 'unavailable');
  assert.equal(usage.availability, 'reported');
  assert.equal(JSON.parse(readFileSync(join(observedRun, 'result.json'), 'utf8')).usage.input_tokens, 100);

  mkdirSync(join(observedRun, 'logs', 'stages', 'S0', 'attempt-02'), { recursive: true });
  writeFileSync(
    join(observedRun, 'logs', 'stages', 'S0', 'attempt-02', 'stdout.raw'),
    `${JSON.stringify({
      type: 'result',
      usage: { input_tokens: 50, output_tokens: 5 },
      total_cost_usd: 0.25,
    })}\n`,
  );
  const partialCostUsage = collectReportedUsage(observedRun, observedCase);
  assert.equal(partialCostUsage.input_tokens, 150);
  assert.equal(partialCostUsage.output_tokens, 15);
  assert.equal(partialCostUsage.cost_usd, null);
  assert.equal(partialCostUsage.cost_availability, 'partial');

  mkdirSync(join(observedRun, 'logs', 'stages', 'S0', 'attempt-03'), { recursive: true });
  writeFileSync(
    join(observedRun, 'logs', 'stages', 'S0', 'attempt-03', 'stdout.raw'),
    `${JSON.stringify({ type: 'error', message: 'failed before usage' })}\n`,
  );
  const missingAttemptUsage = collectReportedUsage(observedRun, observedCase);
  assert.equal(missingAttemptUsage.input_tokens, null);
  assert.equal(missingAttemptUsage.output_tokens, null);
  assert.equal(missingAttemptUsage.cost_usd, null);
  assert.equal(missingAttemptUsage.availability, 'partial');
  assert.equal(missingAttemptUsage.cost_availability, 'partial');
  assert.equal(
    JSON.parse(readFileSync(join(observedRun, 'result.json'), 'utf8')).usage.cost_availability,
    'partial',
  );

  process.stdout.write('development smoke flow passed\n');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
