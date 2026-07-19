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

function parseArgs(argv) {
  const parsed = {
    case: 'dev-workflow-smoke',
    engine: 'claude',
    model: 'deepseek-v4-flash',
    provider: 'claude-code-configured-provider',
    wall_time_minutes: null,
    max_stage_cost_usd: null,
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

function evaluateCheckpoints(runDir, caseDir) {
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

function runFixtureTest(runDir, required) {
  const workspace = join(runDir, 'workspace');
  const testPath = join(workspace, 'tests', 'smoke.mjs');
  if (!existsSync(testPath)) {
    return {
      status: required ? 'fail' : 'skip',
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

function createMachineEvidence(runDir, runEnvelope, caseDir, isDevelopmentSmoke) {
  const checkpoint = evaluateCheckpoints(runDir, caseDir);
  const fixtureTest = runFixtureTest(runDir, isDevelopmentSmoke);
  const flowPassed = runEnvelope.status === 'success'
    && checkpoint.passed
    && (!isDevelopmentSmoke || fixtureTest.status === 'pass');

  writeText(join(runDir, 'logs', 'real-smoke-fixture-test.stdout'), fixtureTest.stdout);
  writeText(join(runDir, 'logs', 'real-smoke-fixture-test.stderr'), fixtureTest.stderr);
  writeJson(join(runDir, 'logs', 'real-smoke-checkpoints.json'), checkpoint);
  writeJson(join(runDir, 'evaluator-summary.json'), {
    status: flowPassed ? (isDevelopmentSmoke ? 'success' : 'partial') : 'error',
    summary: {
      p0_state: isDevelopmentSmoke ? (flowPassed ? 'passed' : 'failed') : 'unknown',
      flow_passed: flowPassed,
      business_acceptance_pending: !isDevelopmentSmoke,
      ...(isDevelopmentSmoke ? {
        p0_passed: flowPassed,
        score: flowPassed ? 100 : 0,
        p0_min_score: 80,
      } : {}),
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
    note: '文件级隔离运行；未证明宿主机级别的读取隔离，因此不可进入正式排行榜。',
  });
  writeJson(join(runDir, 'browser-evidence.json'), {
    status: existsSync(join(runDir, 'workspace', 'index.html')) ? 'partial' : 'error',
    driver: 'development-static-check',
    canvas_webgl_proven: false,
    artifacts: existsSync(join(runDir, 'workspace', 'index.html'))
      ? ['workspace/index.html']
      : [],
    note: '尚未完成真实浏览器评审；正式可视化 Case 不能据此判定业务验收通过。',
  });
  return { flowPassed, businessAccepted: isDevelopmentSmoke ? flowPassed : null };
}

function collectReportedUsage(runDir, caseDir) {
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

function generateReport(runDir, caseMeta, outcome) {
  const reportDir = join(runDir, 'reports');
  mkdirSync(reportDir, { recursive: true });
  const isDevelopmentSmoke = caseMeta.task_type === 'development-smoke';
  const entry = loadEntry(runDir, {
    demo: isDevelopmentSmoke,
    caseMeta: { title: caseMeta.title },
  });
  const reportId = `${isDevelopmentSmoke ? 'real-smoke' : 'case-run'}-${entry.run.run_id}`;
  const report = buildReport({
    entries: [entry],
    reportId,
    generatedAt: new Date().toISOString(),
    title: `${caseMeta.title} · 真实模型评测报告 · ${entry.run.engine?.model || '未知模型'}`,
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
  return { outcome, artifacts: [htmlPath, jsonPath, markdownPath] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.engine !== 'claude') {
    throw new Error('当前真实模型统一入口仅验证了 --engine claude；启用其他引擎前需先完成适配器验证。');
  }
  const caseId = String(args.case);
  const caseDir = join(projectRoot, 'cases', caseId);
  const caseMetaPath = join(caseDir, 'case.yaml');
  if (!existsSync(caseMetaPath)) {
    throw new Error(`Case 不存在：${caseId}`);
  }
  const caseMeta = parseYaml(readFileSync(caseMetaPath, 'utf8'));
  const scenario = parseYaml(readFileSync(join(caseDir, caseMeta.scenario || 'scenario/stages.yaml'), 'utf8'));
  const stageCount = scenario.stages?.length || 0;
  const isDevelopmentSmoke = caseMeta.task_type === 'development-smoke';
  const workspaceSource = args.workspace_source
    ? resolve(args.workspace_source)
    : (existsSync(join(caseDir, 'fixture', 'starter'))
      ? join(caseDir, 'fixture', 'starter')
      : join(caseDir, 'fixture'));
  const wallTimeMinutes = args.wall_time_minutes || (isDevelopmentSmoke ? '10' : '180');
  const maxStageCostUsd = args.max_stage_cost_usd || (isDevelopmentSmoke ? '0.50' : null);
  if (!existsSync(workspaceSource)) {
    throw new Error(`Case 缺少可运行 Fixture：${workspaceSource}`);
  }
  if (!isDevelopmentSmoke && maxStageCostUsd == null && !args.dry_run) {
    throw new Error('正式 Case 必须显式设置 --max-stage-cost-usd，避免无人值守运行失控。');
  }

  const resolvedConfig = {
    case_id: caseId,
    case_title: caseMeta.title,
    task_type: caseMeta.task_type,
    engine: args.engine,
    model: args.model,
    provider: args.provider,
    workspace_source: workspaceSource,
    stage_count: stageCount,
    wall_time_minutes: Number(wallTimeMinutes),
    max_stage_cost_usd: maxStageCostUsd === 'none' || maxStageCostUsd == null
      ? null
      : Number(maxStageCostUsd),
    max_possible_run_cost_usd: maxStageCostUsd === 'none' || maxStageCostUsd == null
      ? null
      : Number(maxStageCostUsd) * stageCount,
    business_acceptance_requires_human_review: !isDevelopmentSmoke,
  };
  if (args.dry_run) {
    process.stdout.write(`${JSON.stringify({
      status: 'success',
      summary: '配置解析成功；未调用模型。',
      resolved_config: resolvedConfig,
      next_actions: ['移除 --dry-run 后执行真实模型评测。'],
      artifacts: [],
    }, null, 2)}\n`);
    return;
  }

  const prepareArgs = [
    'scripts/bench.mjs',
    'prepare',
    '--case', caseId,
    '--engine', args.engine,
    '--model', args.model,
    '--provider', args.provider,
    '--wall-time-minutes', wallTimeMinutes,
    '--workspace-source', workspaceSource,
  ];
  if (maxStageCostUsd !== 'none') {
    prepareArgs.push('--max-cost-usd', maxStageCostUsd);
  }

  const prepared = runNode(prepareArgs);
  if (prepared.envelope.status !== 'success') {
    throw new Error(`Prepare failed: ${prepared.envelope.summary}`);
  }
  const runDir = prepared.envelope.run_dir;
  writeJson(join(runDir, 'logs', 'real-smoke-orchestrator.json'), {
    mode: isDevelopmentSmoke ? 'real-model-development-smoke' : 'real-model-case-benchmark',
    ...resolvedConfig,
    started_at: new Date().toISOString(),
  });

  const executed = runNode(
    ['scripts/bench.mjs', 'run', '--run-dir', runDir],
    { timeout: Number(wallTimeMinutes) * 60_000 + 30_000 },
  );
  const usage = collectReportedUsage(runDir, caseDir);
  const outcome = createMachineEvidence(runDir, executed.envelope, caseDir, isDevelopmentSmoke);
  const report = generateReport(runDir, caseMeta, outcome);

  process.stdout.write(`${JSON.stringify({
    status: outcome.flowPassed ? 'success' : 'warning',
    summary: outcome.flowPassed
      ? `${caseMeta.title} 已使用 ${args.model} 跑完；流程门禁通过${isDevelopmentSmoke ? '。' : '，业务验收仍待浏览器与人工评审。'}`
      : `${caseMeta.title} 已使用 ${args.model} 运行，但一个或多个流程门禁失败。`,
    next_actions: outcome.flowPassed
      ? [isDevelopmentSmoke
        ? '检查模型事件和演示报告；该运行不可用于正式排行榜结论。'
        : '进入浏览器评审并补录人工评分、修改时间和最终验收结论。']
      : ['检查 real-smoke-checkpoints.json 和各阶段 stderr，修复根因后仅重试一次。'],
    artifacts: [
      ...report.artifacts,
      join(runDir, 'logs', 'real-smoke-checkpoints.json'),
      join(runDir, 'logs', 'stages'),
    ],
    run_id: prepared.envelope.run_id,
    run_dir: runDir,
    case_id: caseId,
    case_title: caseMeta.title,
    configured_model: args.model,
    configured_provider: args.provider,
    configured_stage_cost_cap_usd: maxStageCostUsd === 'none'
      ? null
      : Number(maxStageCostUsd),
    observed_models: usage.observed_models,
    reported_cost_usd: usage.cost_usd,
    reported_tokens: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cached_tokens: usage.cached_tokens,
    },
    leaderboard_eligible: false,
    business_acceptance: outcome.businessAccepted == null ? 'pending-human-review' : 'accepted',
  }, null, 2)}\n`);
  if (!outcome.flowPassed) process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: 'error',
    summary: error.message,
    next_actions: [
      '修复根因后重试一次。',
      '连续两次出现相同失败时停止，并保留 Run 目录用于回溯。',
    ],
    artifacts: [],
    error: {
      root_cause_hint: error.message,
      safe_retry: '修正配置或适配器参数后仅重试一次。',
      stop_condition: '连续两次相同失败后停止。',
    },
  }, null, 2)}\n`);
  process.exitCode = 1;
}
