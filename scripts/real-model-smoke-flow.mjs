#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { buildReport } from '../src/reporting/builders.mjs';
import { loadEntry } from '../src/reporting/load.mjs';
import { renderHtml, renderMarkdown } from '../src/reporting/render/index.mjs';
import { validateReport } from '../src/reporting/validate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const caseId = 'dev-workflow-smoke';
const caseDir = join(projectRoot, 'cases', caseId);

function parseArgs(argv) {
  const parsed = {
    engine: 'claude',
    model: 'deepseek-v4-flash',
    provider: 'claude-code-configured-provider',
    wall_time_minutes: '10',
    max_stage_cost_usd: '0.50',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2).replaceAll('-', '_');
    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  if (parsed.max_cost_usd != null) {
    parsed.max_stage_cost_usd = parsed.max_cost_usd;
  }
  return parsed;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`);
}

function runNode(args, { cwd = projectRoot, timeout = 15 * 60_000 } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    shell: false,
    env: process.env,
  });
  if (result.error) {
    throw new Error(`Command ${args.join(' ')} failed to start: ${result.error.message}`);
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Command ${args.join(' ')} did not return a JSON envelope: ${(result.stderr || result.stdout).slice(0, 500)}`);
  }
  return { result, envelope };
}

function evaluateCheckpoints(runDir) {
  const scenario = parseYaml(readFileSync(join(caseDir, 'scenario', 'stages.yaml'), 'utf8'));
  const workspace = join(runDir, 'workspace');
  const checks = scenario.stages.map(stage => {
    const missing = stage.checkpoint.filter(path => !existsSync(join(workspace, path)));
    return {
      id: `checkpoint-${stage.id}`,
      stage_id: stage.id,
      status: missing.length ? 'fail' : 'pass',
      expected: stage.checkpoint,
      missing,
    };
  });
  return { checks, passed: checks.every(check => check.status === 'pass') };
}

function runFixtureTest(runDir) {
  const workspace = join(runDir, 'workspace');
  const testPath = join(workspace, 'tests', 'smoke.mjs');
  if (!existsSync(testPath)) {
    return {
      status: 'fail',
      exit_code: null,
      stdout: '',
      stderr: 'tests/smoke.mjs is missing',
    };
  }
  const result = spawnSync(process.execPath, ['tests/smoke.mjs'], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30_000,
    shell: false,
  });
  return {
    status: result.status === 0 ? 'pass' : 'fail',
    exit_code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function createMachineEvidence(runDir, runEnvelope) {
  const checkpoint = evaluateCheckpoints(runDir);
  const fixtureTest = runFixtureTest(runDir);
  const passed = runEnvelope.status === 'success'
    && checkpoint.passed
    && fixtureTest.status === 'pass';

  writeText(join(runDir, 'logs', 'real-smoke-fixture-test.stdout'), fixtureTest.stdout);
  writeText(join(runDir, 'logs', 'real-smoke-fixture-test.stderr'), fixtureTest.stderr);
  writeJson(join(runDir, 'logs', 'real-smoke-checkpoints.json'), checkpoint);
  writeJson(join(runDir, 'evaluator-summary.json'), {
    status: passed ? 'success' : 'error',
    summary: {
      p0_passed: passed,
      score: passed ? 100 : 0,
      p0_min_score: 80,
    },
    checks: [
      ...checkpoint.checks,
      {
        id: 'fixture-test',
        status: fixtureTest.status,
        exit_code: fixtureTest.exit_code,
        evidence: ['logs/real-smoke-fixture-test.stdout', 'logs/real-smoke-fixture-test.stderr'],
      },
    ],
  });
  writeJson(join(runDir, 'isolation.json'), {
    mode: 'file-isolated-development',
    leaderboard_eligible: false,
    network: true,
    real_model: true,
    note: 'Development smoke only; host-level read isolation is not proven.',
  });
  writeJson(join(runDir, 'browser-evidence.json'), {
    status: existsSync(join(runDir, 'workspace', 'index.html')) ? 'partial' : 'error',
    driver: 'development-static-check',
    canvas_webgl_proven: false,
    artifacts: existsSync(join(runDir, 'workspace', 'index.html'))
      ? ['workspace/index.html']
      : [],
    note: 'A real browser review is outside the fast real-model smoke scope.',
  });
  return passed;
}

function collectReportedUsage(runDir) {
  const stagesDir = join(runDir, 'logs', 'stages');
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    cost_usd: 0,
    availability: 'unavailable',
    observed_models: [],
    stage_reports: [],
  };
  if (!existsSync(stagesDir)) return totals;

  const scenario = parseYaml(readFileSync(join(caseDir, 'scenario', 'stages.yaml'), 'utf8'));
  const observedModels = new Set();
  let reports = 0;
  for (const stage of scenario.stages) {
    const stdoutPath = join(stagesDir, stage.id, 'stdout.raw');
    if (!existsSync(stdoutPath)) continue;
    const lines = readFileSync(stdoutPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const resultEvents = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'result') resultEvents.push(event);
      } catch {
        // Raw non-JSON output remains available in stdout.raw.
      }
    }
    const event = resultEvents.at(-1);
    if (!event) continue;
    reports += 1;
    const usage = event.usage || {};
    totals.input_tokens += Number(usage.input_tokens || 0);
    totals.output_tokens += Number(usage.output_tokens || 0);
    totals.cached_tokens += Number(usage.cache_read_input_tokens || 0);
    totals.cost_usd += Number(event.total_cost_usd || 0);
    for (const model of Object.keys(event.modelUsage || {})) observedModels.add(model);
    totals.stage_reports.push({
      stage_id: stage.id,
      subtype: event.subtype || null,
      cost_usd: event.total_cost_usd ?? null,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      cached_tokens: usage.cache_read_input_tokens ?? null,
      observed_models: Object.keys(event.modelUsage || {}),
    });
  }
  totals.cost_usd = Number(totals.cost_usd.toFixed(6));
  totals.availability = reports > 0 ? 'reported' : 'unavailable';
  totals.observed_models = [...observedModels].sort();
  writeJson(join(runDir, 'logs', 'real-smoke-usage.json'), totals);

  const resultPath = join(runDir, 'result.json');
  if (existsSync(resultPath)) {
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    result.usage = {
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      cached_tokens: totals.cached_tokens,
      cost_usd: totals.cost_usd,
      availability: totals.availability,
    };
    result.engine.observed_models = totals.observed_models;
    writeJson(resultPath, result);
  }
  return totals;
}

function generateDemoReport(runDir, passed) {
  const reportDir = join(runDir, 'reports');
  mkdirSync(reportDir, { recursive: true });
  const entry = loadEntry(runDir, {
    demo: true,
    caseMeta: { title: '真实模型开发流程 Smoke' },
  });
  const reportId = `real-smoke-${entry.run.run_id}`;
  const report = buildReport({
    entries: [entry],
    reportId,
    generatedAt: new Date().toISOString(),
    title: `Real-model Development Smoke · ${entry.run.engine?.model || 'unknown-model'}`,
  });
  const validation = validateReport(report);
  if (!validation.valid) {
    throw new Error(`Generated report is invalid: ${JSON.stringify(validation.errors.slice(0, 3))}`);
  }
  const jsonPath = join(reportDir, 'report.json');
  const markdownPath = join(reportDir, 'report.md');
  const htmlPath = join(reportDir, 'report.html');
  writeJson(jsonPath, report);
  writeText(markdownPath, renderMarkdown(report));
  writeText(htmlPath, renderHtml(report));
  return { passed, artifacts: [htmlPath, jsonPath, markdownPath] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.engine !== 'claude') {
    throw new Error('Real smoke currently supports --engine claude only; add a tested adapter before enabling another engine.');
  }

  const prepareArgs = [
    'scripts/bench.mjs',
    'prepare',
    '--case', caseId,
    '--engine', args.engine,
    '--model', args.model,
    '--provider', args.provider,
    '--wall-time-minutes', args.wall_time_minutes,
    '--workspace-source', join(caseDir, 'fixture'),
  ];
  if (args.max_stage_cost_usd !== 'none') {
    prepareArgs.push('--max-cost-usd', args.max_stage_cost_usd);
  }

  const prepared = runNode(prepareArgs);
  if (prepared.envelope.status !== 'success') {
    throw new Error(`Prepare failed: ${prepared.envelope.summary}`);
  }
  const runDir = prepared.envelope.run_dir;
  writeJson(join(runDir, 'logs', 'real-smoke-orchestrator.json'), {
    mode: 'real-model-development-smoke',
    engine: args.engine,
    configured_model: args.model,
    configured_provider: args.provider,
    max_stage_cost_usd: args.max_stage_cost_usd,
    max_possible_run_cost_usd: args.max_stage_cost_usd === 'none'
      ? null
      : Number(args.max_stage_cost_usd) * 3,
    started_at: new Date().toISOString(),
  });

  const executed = runNode(
    ['scripts/bench.mjs', 'run', '--run-dir', runDir],
    { timeout: Number(args.wall_time_minutes) * 60_000 + 30_000 },
  );
  const usage = collectReportedUsage(runDir);
  const passed = createMachineEvidence(runDir, executed.envelope);
  const report = generateDemoReport(runDir, passed);

  process.stdout.write(`${JSON.stringify({
    status: passed ? 'success' : 'warning',
    summary: passed
      ? `Real-model smoke completed with ${args.model}; all three stage checkpoints and the fixture test passed.`
      : `Real-model smoke completed with ${args.model}, but one or more machine gates failed.`,
    next_actions: passed
      ? ['Inspect model events and the DEMO report; do not use this run for leaderboard conclusions.']
      : ['Inspect real-smoke-checkpoints.json and stage stderr before retrying once.'],
    artifacts: [
      ...report.artifacts,
      join(runDir, 'logs', 'real-smoke-checkpoints.json'),
      join(runDir, 'logs', 'stages'),
    ],
    run_id: prepared.envelope.run_id,
    run_dir: runDir,
    configured_model: args.model,
    configured_provider: args.provider,
    configured_stage_cost_cap_usd: args.max_stage_cost_usd === 'none'
      ? null
      : Number(args.max_stage_cost_usd),
    observed_models: usage.observed_models,
    reported_cost_usd: usage.cost_usd,
    reported_tokens: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cached_tokens: usage.cached_tokens,
    },
    leaderboard_eligible: false,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: 'error',
    summary: error.message,
    next_actions: [
      'Fix the root cause and retry once.',
      'Stop after two identical failures and preserve the Run directory.',
    ],
    artifacts: [],
    error: {
      root_cause_hint: error.message,
      safe_retry: 'Retry once after correcting configuration or adapter arguments.',
      stop_condition: 'Stop after two identical failures.',
    },
  }, null, 2)}\n`);
  process.exitCode = 1;
}
