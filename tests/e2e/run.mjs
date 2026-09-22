import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { PRIMARY_CASES } from '../../src/control-plane/case-registry.mjs';
import { fileDigest, runGoldenPipeline } from '../../src/control-plane/pipeline.mjs';
import { buildRunSpec } from '../../src/control-plane/run-spec.mjs';
import { containedRunDirectory } from '../../src/core/run-id.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const outputRoot = mkdtempSync(join(tmpdir(), 'vab-t08-e2e-'));
const localRunDirs = [];
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.stack });
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
  }
}

function specFor(caseId) {
  return buildRunSpec({
    name: `golden-${caseId}`,
    case_id: caseId,
    engine: {
      adapter: 'codex-cli',
      executable: 'codex',
      configured_model: 'deterministic-fake',
      provider: 'local',
      credential_ref: 'secret://fake/not-used',
    },
    network: false,
    wall_time_minutes: 10,
    max_retries: 1,
  });
}

function checkpointWriterLines() {
  return [
    'let prompt = process.argv.slice(2).join(" ") + " ";',
    'for await (const chunk of process.stdin) prompt += chunk;',
    'const stage = process.env.VIS_AGENT_BENCH_STAGE_ID || "S0";',
    'fs.writeFileSync("requirement-ledger.yaml", "requirements:\\n  - id: fake\\n    priority: must\\n");',
    'const match = prompt.match(/本阶段 checkpoint：(.*)/);',
    'const names = match ? match[1].split("、").map(x => x.trim()).filter(Boolean) : [];',
    'const artifacts = {};',
    'for (const name of names) {',
    '  if (name === "final-requirement-ledger" || name === "requirement-ledger.yaml") continue;',
    '  if (/[/.]/.test(name)) { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, "fake checkpoint\\n"); continue; }',
    '  const ref = `.vab/evidence/${stage}-${name}.txt`;',
    '  fs.mkdirSync(path.dirname(ref), { recursive: true }); fs.writeFileSync(ref, "fake evidence\\n"); artifacts[name] = [ref];',
    '}',
    'fs.mkdirSync(".vab/checkpoints", { recursive: true });',
    'fs.writeFileSync(`.vab/checkpoints/${stage}.json`, JSON.stringify({ schema_version: 1, stage_id: stage, artifacts }, null, 2));',
  ];
}

try {
  await check('all three primary Cases complete the checkpointed golden pipeline', async () => {
    for (const caseId of PRIMARY_CASES) {
      const runId = `golden-${caseId}`;
      const result = await runGoldenPipeline({
        projectRoot,
        spec: specFor(caseId),
        outRoot: outputRoot,
        runId,
      });
      assert.equal(result.status, 'success', JSON.stringify(result, null, 2));
      const runDir = join(outputRoot, runId);
      for (const path of [
        'run-spec.json',
        'result.json',
        'evaluator-summary.json',
        'browser-evidence.json',
        'human-review.json',
        `reports/${runId}.html`,
        'logs/checkpoints.json',
        'workspace/.fixture/manifest.json',
      ]) {
        assert.ok(existsSync(join(runDir, path)), `${caseId} missing ${path}`);
      }
      const evaluator = JSON.parse(readFileSync(join(runDir, 'evaluator-summary.json'), 'utf8'));
      assert.equal(evaluator.status, 'success');
      assert.equal(evaluator.scorecard.total, 100);
      assert.equal(evaluator.evidence_trust.mode, 'control-plane-attested');
      assert.equal(evaluator.evidence_trust.conclusion_eligible, false);
      assert.equal(evaluator.conclusion_eligible, false);
      const browser = JSON.parse(readFileSync(join(runDir, 'browser-evidence.json'), 'utf8'));
      assert.equal(browser.status, 'success');
      assert.equal(browser.failures.length, 0);
    }
  });

  await check('failure after run resumes without repeating fixture or runner side effects', async () => {
    const caseId = 'narrative-equity-relationship';
    const runId = 'resume-after-run';
    const first = await runGoldenPipeline({
      projectRoot,
      spec: specFor(caseId),
      outRoot: outputRoot,
      runId,
      failAfter: 'run',
    });
    assert.equal(first.status, 'error');
    const runDir = join(outputRoot, runId);
    const checkpointsBefore = JSON.parse(readFileSync(join(runDir, 'logs/checkpoints.json'), 'utf8'));
    const fixtureCompletedAt = checkpointsBefore.completed.fixture.completed_at;
    const resultDigest = fileDigest(join(runDir, 'result.json'));
    const fixtureDigest = fileDigest(join(runDir, 'workspace/.fixture/manifest.json'));
    await assert.rejects(
      runGoldenPipeline({
        projectRoot,
        spec: { ...specFor(caseId), name: 'mutated-spec' },
        outRoot: outputRoot,
        runId,
        resume: true,
      }),
      /RunSpec digest mismatch/,
    );

    const resumed = await runGoldenPipeline({
      projectRoot,
      spec: specFor(caseId),
      outRoot: outputRoot,
      runId,
      resume: true,
    });
    assert.equal(resumed.status, 'success', JSON.stringify(resumed, null, 2));
    const checkpointsAfter = JSON.parse(readFileSync(join(runDir, 'logs/checkpoints.json'), 'utf8'));
    assert.equal(checkpointsAfter.completed.fixture.completed_at, fixtureCompletedAt);
    assert.equal(fileDigest(join(runDir, 'result.json')), resultDigest);
    assert.equal(fileDigest(join(runDir, 'workspace/.fixture/manifest.json')), fixtureDigest);
    assert.deepEqual(
      Object.keys(checkpointsAfter.completed),
      ['validate', 'fixture', 'run', 'capture', 'evaluate', 'review', 'report'],
    );
  });

  await check('bench prepare/run uses canonical RunSpec and records real CLI telemetry', () => {
    const executable = join(outputRoot, 'fake-codex.mjs');
    writeFileSync(executable, [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const version = process.argv.includes("--version");',
      'if (version) { process.stdout.write("fake-codex 1.2.3\\n"); process.exit(0); }',
      ...checkpointWriterLines(),
      'process.stdout.write(JSON.stringify({ type: "result", session_id: "fake-session-00000001", usage: { input_tokens: 2, output_tokens: 3 }, leaked_secret: process.env.VAB_TEST_SECRET ?? null }) + "\\n");',
      '',
    ].join('\n'));
    chmodSync(executable, 0o755);
    const runId = `bench-cli-smoke-${process.pid}`;
    const prepare = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'prepare',
      '--case', 'narrative-equity-relationship',
      '--engine', 'codex',
      '--model', 'fake-model',
      '--executable', executable,
      '--run-id', runId,
      '--wall-time-minutes', '5',
    ], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, VAB_TEST_SECRET: 'must-not-leak' } });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const prepared = JSON.parse(prepare.stdout);
    localRunDirs.push(prepared.run_dir);
    assert.equal(prepared.status, 'success');
    assert.match(
      readFileSync(join(prepared.run_dir, 'input/stage-S0.md'), 'utf8'),
      /"stage_id":"S0"/,
    );

    const run = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'run',
      '--run-dir', prepared.run_dir,
    ], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, VAB_TEST_SECRET: 'must-not-leak' } });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const completed = JSON.parse(run.stdout);
    assert.equal(completed.status, 'success');
    const result = JSON.parse(readFileSync(join(prepared.run_dir, 'result.json'), 'utf8'));
    assert.equal(result.run_id, runId);
    assert.equal(result.engine.cli_version, 'fake-codex 1.2.3');
    assert.equal(result.usage.availability, 'reported');
    assert.ok(result.usage.total_tokens >= 5);
    const firstStage = result.stages.find(stage => stage.stage_id === 'S0');
    const firstEvent = JSON.parse(readFileSync(firstStage.stdoutPath, 'utf8').trim());
    assert.equal(firstEvent.leaked_secret, null);
    assert.ok(existsSync(join(prepared.run_dir, 'human-review.json')));
  });

  await check('bench prepare honors a model profile with case and executable overrides', () => {
    const executable = join(outputRoot, 'fake-opencode.mjs');
    writeFileSync(executable, [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const version = process.argv.includes("--version");',
      'if (version) { process.stdout.write("fake-opencode 1.0.0\\n"); process.exit(0); }',
      ...checkpointWriterLines(),
      'process.stdout.write(JSON.stringify({ type: "session", session: { id: "fake-opencode-session1" } }) + "\\n");',
      'process.stdout.write(JSON.stringify({ type: "text", content: "done" }) + "\\n");',
      '',
    ].join('\n'));
    chmodSync(executable, 0o755);
    const runId = `bench-model-profile-${process.pid}`;
    const prepare = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'prepare',
      '--spec', 'config/models/opencode-zai-glm-5.3-high.yaml',
      '--case', 'ainvest-market-heatmap-rebuild',
      '--executable', executable,
      '--run-id', runId,
      '--wall-time-minutes', '5',
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const prepared = JSON.parse(prepare.stdout);
    localRunDirs.push(prepared.run_dir);
    assert.equal(prepared.status, 'success');
    const spec = JSON.parse(readFileSync(join(prepared.run_dir, 'run-spec.json'), 'utf8'));
    assert.equal(spec.case_id, 'ainvest-market-heatmap-rebuild');
    assert.equal(spec.engine.configured_model, 'zai-coding-plan/glm-5.3');
    assert.equal(spec.engine.reasoning_effort, 'high');
    assert.equal(spec.engine.executable, executable);

    const run = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'run',
      '--run-dir', prepared.run_dir,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const commands = JSON.parse(readFileSync(join(prepared.run_dir, 'logs', 'commands.json'), 'utf8'));
    assert.ok(commands.length > 0);
    const first = commands[0];
    assert.equal(first.executable, executable);
    assert.equal(first.args[first.args.indexOf('--variant') + 1], 'high');
    assert.equal(first.args[first.args.indexOf('--model') + 1], 'zai-coding-plan/glm-5.3');
  });

  await check('bench retry preserves failed-attempt evidence and resumes the failed stage', () => {
    const executable = join(outputRoot, 'flaky-codex.mjs');
    writeFileSync(executable, [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'if (process.argv.includes("--version")) { process.stdout.write("flaky-codex 1.0.0\\n"); process.exit(0); }',
      ...checkpointWriterLines(),
      'const marker = ".fake-invocations";',
      'const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0;',
      'fs.writeFileSync(marker, String(count + 1));',
      'process.stdout.write(JSON.stringify({ type: "result", session_id: "flaky-session-0000001" }) + "\\n");',
      'process.exit(count === 0 ? 9 : 0);',
      '',
    ].join('\n'));
    chmodSync(executable, 0o755);
    const runId = `bench-cli-retry-${process.pid}`;
    const prepare = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'prepare',
      '--case', 'ainvest-market-heatmap-rebuild',
      '--engine', 'codex',
      '--model', 'flaky-model',
      '--executable', executable,
      '--run-id', runId,
      '--wall-time-minutes', '5',
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const prepared = JSON.parse(prepare.stdout);
    localRunDirs.push(prepared.run_dir);
    const command = [
      join(projectRoot, 'scripts/bench.mjs'),
      'run',
      '--run-dir', prepared.run_dir,
    ];
    const failed = spawnSync(process.execPath, command, { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(failed.status, 0);
    const resumed = spawnSync(process.execPath, command, { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
    const stageRoot = join(prepared.run_dir, 'logs', 'stages', 'S0');
    assert.ok(existsSync(join(stageRoot, 'attempt-01', 'stdout.raw')));
    assert.ok(existsSync(join(stageRoot, 'attempt-02', 'stdout.raw')));
    const commands = JSON.parse(readFileSync(join(prepared.run_dir, 'logs', 'commands.json'), 'utf8'));
    assert.equal(commands.filter(item => item.stage_id === 'S0').length, 2);
  });

  await check('setup-page RunSpec bundle directly prepares CLI runs', () => {
    const bundlePath = join(outputRoot, 'setup-bundle.json');
    writeFileSync(bundlePath, JSON.stringify({
      schema_version: 1,
      kind: 'vis-agent-bench-run-spec-bundle',
      generated_at: new Date().toISOString(),
      runs: [specFor('macro-map-3d-greenfield'), specFor('ainvest-market-heatmap-rebuild')],
    }));
    const prepared = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'prepare-bundle',
      '--bundle', bundlePath,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
    const payload = JSON.parse(prepared.stdout);
    assert.equal(payload.status, 'success');
    assert.equal(payload.runs.length, 2);
    for (const run of payload.runs) {
      localRunDirs.push(run.run_dir);
      assert.ok(existsSync(join(run.run_dir, 'run-spec.json')));
    }
  });

  await check('run-id containment rejects absolute and traversal targets', () => {
    assert.throws(() => containedRunDirectory(outputRoot, '../../escape'), /run-id/);
    assert.throws(() => containedRunDirectory(outputRoot, '/tmp/escape'), /run-id/);
    assert.match(containedRunDirectory(outputRoot, 'safe-run_01'), /safe-run_01$/);
  });

  await check('token and retry budgets stop subsequent model work', () => {
    const executable = join(outputRoot, 'budget-codex.mjs');
    writeFileSync(executable, [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'if (process.argv.includes("--version")) { process.stdout.write("budget-codex 1.0.0\\n"); process.exit(0); }',
      ...checkpointWriterLines(),
      'process.stdout.write(JSON.stringify({ type: "result", session_id: "budget-session-000001", usage: { input_tokens: 10, output_tokens: 5 } }) + "\\n");',
      '',
    ].join('\n'));
    chmodSync(executable, 0o755);
    const prepare = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'prepare',
      '--case', 'narrative-equity-relationship',
      '--engine', 'codex',
      '--model', 'budget-model',
      '--executable', executable,
      '--run-id', `bench-budget-${process.pid}`,
      '--max-tokens', '1',
      '--max-retries', '0',
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const prepared = JSON.parse(prepare.stdout);
    localRunDirs.push(prepared.run_dir);
    const command = [
      join(projectRoot, 'scripts/bench.mjs'), 'run', '--run-dir', prepared.run_dir,
    ];
    const first = spawnSync(process.execPath, command, { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(first.status, 0);
    const result = JSON.parse(readFileSync(join(prepared.run_dir, 'result.json'), 'utf8'));
    assert.equal(result.stages[0].failure_source, 'budget');
    const second = spawnSync(process.execPath, command, { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    const commands = JSON.parse(readFileSync(join(prepared.run_dir, 'logs', 'commands.json'), 'utf8'));
    assert.equal(commands.length, 1);
  });

  await check('explicit blocked agent status cannot advance a stage', () => {
    const executable = join(outputRoot, 'blocked-codex.mjs');
    writeFileSync(executable, [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'if (process.argv.includes("--version")) { process.stdout.write("blocked-codex 1.0.0\\n"); process.exit(0); }',
      ...checkpointWriterLines(),
      'process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "status: `blocked`\\nsummary: cannot continue" } }) + "\\n");',
      '',
    ].join('\n'));
    chmodSync(executable, 0o755);
    const prepare = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'), 'prepare',
      '--case', 'narrative-equity-relationship',
      '--engine', 'codex',
      '--model', 'blocked-model',
      '--executable', executable,
      '--run-id', `bench-blocked-${process.pid}`,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const prepared = JSON.parse(prepare.stdout);
    localRunDirs.push(prepared.run_dir);
    const run = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'), 'run', '--run-dir', prepared.run_dir,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(readFileSync(join(prepared.run_dir, 'result.json'), 'utf8'));
    assert.equal(result.stages[0].failure_source, 'agent-status');
    assert.equal(result.stages[0].agent_status, 'blocked');

    const kimiExecutable = join(outputRoot, 'blocked-kimi.mjs');
    writeFileSync(kimiExecutable, [
      '#!/usr/bin/env node',
      'if (process.argv.includes("--version")) { process.stdout.write("blocked-kimi 1.0.0\\n"); process.exit(0); }',
      'process.stdout.write(JSON.stringify({ event: "message.delta", text: "status: `blo" }) + "\\n");',
      'process.stdout.write(JSON.stringify({ event: "message.delta", text: "cked`\\nsummary: cannot continue" }) + "\\n");',
      '',
    ].join('\n'));
    chmodSync(kimiExecutable, 0o755);
    const kimiPrepare = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'), 'prepare',
      '--case', 'narrative-equity-relationship',
      '--engine', 'kimi',
      '--model', 'blocked-kimi-model',
      '--executable', kimiExecutable,
      '--run-id', `bench-blocked-kimi-${process.pid}`,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(kimiPrepare.status, 0, kimiPrepare.stderr || kimiPrepare.stdout);
    const kimiPrepared = JSON.parse(kimiPrepare.stdout);
    localRunDirs.push(kimiPrepared.run_dir);
    const kimiRun = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'), 'run', '--run-dir', kimiPrepared.run_dir,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(kimiRun.status, 0);
    const kimiResult = JSON.parse(readFileSync(join(kimiPrepared.run_dir, 'result.json'), 'utf8'));
    assert.equal(kimiResult.stages[0].failure_source, 'agent-status');
    assert.equal(kimiResult.stages[0].agent_status, 'blocked');
  });

  await check('final gate rejects no-op replacement of baseline package scripts, including old RunState', () => {
    const executable = join(outputRoot, 'script-deleting-codex.mjs');
    writeFileSync(executable, [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { spawnSync } from "node:child_process";',
      'if (process.argv.includes("--version")) { process.stdout.write("script-deleting-codex 1.0.0\\n"); process.exit(0); }',
      ...checkpointWriterLines(),
      `if (stage === "S5") { const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); for (const name of ["build", "typecheck", "test"]) pkg.scripts[name] = ${JSON.stringify('node -e "process.exit(0)"')}; fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2)); spawnSync("git", ["add", "package.json"]); spawnSync("git", ["-c", "user.name=fake", "-c", "user.email=fake@local", "commit", "-qm", "replace package gates"]); }`,
      'process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "status: success" }, session_id: "delete-session-000001" }) + "\\n");',
      '',
    ].join('\n'));
    chmodSync(executable, 0o755);
    const prepare = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'), 'prepare',
      '--case', 'narrative-equity-relationship',
      '--engine', 'codex',
      '--model', 'deleting-model',
      '--executable', executable,
      '--run-id', `bench-script-delete-${process.pid}`,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const prepared = JSON.parse(prepare.stdout);
    localRunDirs.push(prepared.run_dir);
    const statePath = join(prepared.run_dir, 'run-state.json');
    const oldState = JSON.parse(readFileSync(statePath, 'utf8'));
    delete oldState.package_gate;
    writeFileSync(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
    const run = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'), 'run', '--run-dir', prepared.run_dir,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    const result = JSON.parse(readFileSync(join(prepared.run_dir, 'result.json'), 'utf8'));
    const finalStage = result.stages.at(-1);
    assert.equal(finalStage.failure_source, 'checkpoint-gate');
    assert.match(finalStage.error, /scripts\.build \(changed\)/);
    assert.match(finalStage.error, /scripts\.typecheck \(changed\)/);
    assert.match(finalStage.error, /scripts\.test \(changed\)/);
  });

  await check('report command automatically quarantines demo and ineligible evidence', () => {
    const runDir = join(outputRoot, 'golden-narrative-equity-relationship');
    const outDir = join(outputRoot, 'cli-report');
    const generated = spawnSync(process.execPath, [
      join(projectRoot, 'scripts/bench.mjs'),
      'report',
      '--run-dir', runDir,
      '--out-dir', outDir,
      '--report-id', 'auto-demo',
      '--format', 'json',
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const report = JSON.parse(readFileSync(join(outDir, 'auto-demo.json'), 'utf8'));
    assert.equal(report.data_provenance.demo_inputs_present, true);
    assert.equal(report.data_provenance.leaderboard_eligible, false);
  });
} finally {
  for (const runDir of localRunDirs) rmSync(runDir, { recursive: true, force: true });
  if (process.env.VAB_KEEP_E2E !== '1') rmSync(outputRoot, { recursive: true, force: true });
}

const result = {
  status: failures.length ? 'error' : 'success',
  summary: failures.length ? `${failures.length} T08 E2E check(s) failed.` : '10/10 T08 E2E checks passed.',
  next_actions: failures.length ? ['Fix the golden pipeline before real model runs.'] : [],
  artifacts: process.env.VAB_KEEP_E2E === '1' ? [outputRoot] : ['tests/e2e/run.mjs'],
  ...(failures.length ? { failures } : {}),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
