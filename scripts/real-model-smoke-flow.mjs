#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { buildReport } from '../src/reporting/builders.mjs';
import { loadEntry } from '../src/reporting/load.mjs';
import { renderHtml, renderMarkdown } from '../src/reporting/render/index.mjs';
import { validateReport } from '../src/reporting/validate.mjs';
import { aggregateUsage } from '../src/telemetry/usage.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const parsed = {
    case: 'dev-workflow-smoke',
    engine: 'claude',
    model: null,
    provider: null,
    model_provider: null,
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function stageAttemptPaths(stagesDir, stageId, filename) {
  const stageDir = join(stagesDir, stageId);
  const direct = join(stageDir, filename);
  const paths = existsSync(direct) ? [direct] : [];
  if (!existsSync(stageDir)) return paths;
  for (const entry of readdirSync(stageDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^attempt-\d+$/.test(entry.name)) continue;
    const path = join(stageDir, entry.name, filename);
    if (existsSync(path)) paths.push(path);
  }
  return paths.sort();
}

export function readProgress(runDir) {
  const specPath = join(runDir, 'run-spec.json');
  const statePath = join(runDir, 'run-state.json');
  if (!existsSync(specPath) && !existsSync(statePath)) return null;
  try {
    const spec = existsSync(specPath)
      ? JSON.parse(readFileSync(specPath, 'utf8'))
      : null;
    const state = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, 'utf8'))
      : null;
    const scenario = state?.scenario || spec.scenario || {};
    const stageId = scenario.current_stage || null;
    const stagesDir = join(runDir, 'logs', 'stages');
    const stdoutPaths = stageId ? stageAttemptPaths(stagesDir, stageId, 'stdout.raw') : [];
    const stderrPaths = stageId ? stageAttemptPaths(stagesDir, stageId, 'stderr.raw') : [];
    return {
      status: state?.status || spec?.status || 'unknown',
      stage_id: stageId,
      completed: scenario.completed_stages?.length || 0,
      total: scenario.stage_ids?.length || spec?.scenario?.stage_ids?.length || 0,
      stdout_bytes: stdoutPaths.reduce((sum, path) => sum + statSync(path).size, 0),
      stderr_bytes: stderrPaths.reduce((sum, path) => sum + statSync(path).size, 0),
    };
  } catch {
    return null;
  }
}

function runNodeWithProgress(args, { runDir, timeout }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let lastSignature = '';
    let lastPrintedAt = 0;

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    const printProgress = () => {
      const progress = readProgress(runDir);
      if (!progress) return;
      const signature = JSON.stringify(progress);
      const now = Date.now();
      if (signature === lastSignature && now - lastPrintedAt < 30_000) return;
      process.stderr.write(
        `[VAB] 状态=${progress.status} 阶段=${progress.stage_id || '准备中'} `
        + `完成=${progress.completed}/${progress.total} `
        + `stdout=${formatBytes(progress.stdout_bytes)} stderr=${formatBytes(progress.stderr_bytes)}\n`,
      );
      lastSignature = signature;
      lastPrintedAt = now;
    };
    printProgress();
    const progressTimer = setInterval(printProgress, 5_000);
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeout);

    child.on('error', error => {
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
      reject(new Error(`Command ${args.join(' ')} failed to start: ${error.message}`));
    });
    child.on('close', code => {
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
      printProgress();
      if (timedOut) {
        reject(new Error(`Command ${args.join(' ')} exceeded the configured wall-time limit.`));
        return;
      }
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        reject(new Error(`Command ${args.join(' ')} did not return a JSON envelope: ${(stderr || stdout).slice(0, 500)}`));
        return;
      }
      resolvePromise({
        result: { status: code, stdout, stderr },
        envelope,
      });
    });
  });
}

function evaluateCheckpoints(runDir, caseDir) {
  const scenario = parseYaml(readFileSync(join(caseDir, 'scenario', 'stages.yaml'), 'utf8'));
  const workspace = join(runDir, 'workspace');
  const runnerResultPath = join(runDir, 'result.json');
  const runnerStages = existsSync(runnerResultPath)
    ? new Map((readJson(runnerResultPath).stages || []).map(stage => [stage.stage_id, stage]))
    : new Map();
  const latestCheckpointGate = stageId => {
    const stageLogDir = join(runDir, 'logs', 'stages', stageId);
    if (!existsSync(stageLogDir)) return null;
    const gatePaths = readdirSync(stageLogDir)
      .sort()
      .reverse()
      .map(attempt => join(stageLogDir, attempt, 'checkpoint-gate.json'))
      .filter(existsSync);
    if (!gatePaths.length) return null;
    try {
      return { ...readJson(gatePaths[0]), gate_path: gatePaths[0] };
    } catch {
      return null;
    }
  };
  const checks = scenario.stages.map(stage => {
    const runnerStage = runnerStages.get(stage.id);
    // 恢复运行的 result.json 会将既有阶段压缩为 { resumed_from_checkpoint: true }，
    // 但它们的正式门禁证据仍保存在各 attempt 的 checkpoint-gate.json 中。
    const checkpointGate = runnerStage?.checkpoint_gate || latestCheckpointGate(stage.id);
    // 主 Runner 已验证符号型 checkpoint 对应的 manifest 与其引用文件。后处理器不能再把
    // runnable-poc 之类的符号名误当成 workspace 下的同名物理文件，否则会产生假阴性。
    if (runnerStage?.status === 'success' && checkpointGate?.status === 'success') {
      return {
        id: `checkpoint-${stage.id}`,
        stage_id: stage.id,
        status: 'pass',
        expected: stage.checkpoint,
        missing: [],
        evidence: ['result.json', checkpointGate.gate_path],
      };
    }
    const missing = stage.checkpoint.filter(path => !existsSync(join(workspace, path)));
    return {
      id: `checkpoint-${stage.id}`,
      stage_id: stage.id,
      status: missing.length ? 'fail' : 'pass',
      expected: stage.checkpoint,
      missing,
      ...(runnerStage?.error ? { runner_error: runnerStage.error } : {}),
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

function detectProviderQuotaFailure(runDir) {
  const resultPath = join(runDir, 'result.json');
  if (!existsSync(resultPath)) return null;
  const result = readJson(resultPath);
  const statePath = join(runDir, 'run-state.json');
  const state = existsSync(statePath) ? readJson(statePath) : null;
  // An orchestration/Runner crash can leave the previous result.json in place. Do not let an old
  // quota error override the current failure diagnosis.
  if (state?.active_window_started_at && result.completed_at
    && Date.parse(result.completed_at) < Date.parse(state.active_window_started_at)) {
    return null;
  }
  const failedStage = (result.stages || []).find(stage => stage.status !== 'success');
  if (!failedStage?.stage_id) return null;
  const stageDir = join(runDir, 'logs', 'stages', failedStage.stage_id);
  if (!existsSync(stageDir)) return null;
  const availableStderrPaths = readdirSync(stageDir)
    .sort()
    .reverse()
    .map(attempt => join(stageDir, attempt, 'stderr.raw'))
    .filter(existsSync);
  const resultAttemptPath = Number.isInteger(failedStage.attempt)
    ? join(stageDir, `attempt-${String(failedStage.attempt).padStart(2, '0')}`, 'stderr.raw')
    : null;
  const stderrPaths = resultAttemptPath && existsSync(resultAttemptPath)
    ? [resultAttemptPath]
    : availableStderrPaths.slice(0, 1);
  const stderr = stderrPaths.length ? readFileSync(stderrPaths[0], 'utf8') : '';
  if (!/(?:reached your usage limit|quota will be refreshed|usage limit for this billing cycle)/i.test(stderr)) {
    return null;
  }
  return {
    kind: 'provider-quota-exhausted',
    stage_id: failedStage.stage_id,
    summary: `阶段 ${failedStage.stage_id} 因模型服务额度耗尽而中断；并非需求实现或流程门禁失败。`,
    evidence: stderrPaths,
    next_actions: [
      '等待模型服务额度恢复或在其控制台扩容；恢复前不要消耗同一 Run 的重试次数。',
      '额度恢复后使用 npm run bench:case -- --resume-run <run-id>；已完成阶段、workspace 与原生 Session 会保留。',
    ],
  };
}

function createMachineEvidence(runDir, runEnvelope, caseDir, isDevelopmentSmoke) {
  const checkpoint = evaluateCheckpoints(runDir, caseDir);
  const fixtureTest = runFixtureTest(runDir, isDevelopmentSmoke);
  const providerFailure = detectProviderQuotaFailure(runDir);
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
  if (providerFailure) writeJson(join(runDir, 'logs', 'provider-failure-diagnosis.json'), providerFailure);
  return { flowPassed, businessAccepted: isDevelopmentSmoke ? flowPassed : null, providerFailure };
}

export function collectReportedUsage(runDir, caseDir) {
  const stagesDir = join(runDir, 'logs', 'stages');
  const totals = {
    input_tokens: null,
    output_tokens: null,
    cached_tokens: null,
    cost_usd: null,
    cost_availability: 'unavailable',
    availability: 'unavailable',
    observed_models: [],
    stage_reports: [],
  };
  if (!existsSync(stagesDir)) return totals;

  const scenario = parseYaml(readFileSync(join(caseDir, 'scenario', 'stages.yaml'), 'utf8'));
  const observedModels = new Set();
  let attempts = 0;
  let reports = 0;
  let costReports = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let costUsd = 0;
  for (const stage of scenario.stages) {
    for (const stdoutPath of stageAttemptPaths(stagesDir, stage.id, 'stdout.raw')) {
      attempts += 1;
      const lines = readFileSync(stdoutPath, 'utf8').split(/\r?\n/).filter(Boolean);
      const events = [];
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          events.push(event);
          if (typeof event.model === 'string') observedModels.add(event.model);
          for (const model of Object.keys(event.modelUsage || {})) observedModels.add(model);
        } catch {
          // Raw non-JSON output remains available in stdout.raw.
        }
      }
      // Prefer terminal usage events so providers that repeat cumulative usage
      // on intermediate messages are not double-counted.
      const terminalUsageEvents = events.filter(event =>
        event.type === 'result' || event.type === 'turn.completed' || event.event === 'message.end');
      const usage = aggregateUsage(terminalUsageEvents.length ? terminalUsageEvents : events);
      if (usage.provenance === 'unavailable') {
        totals.stage_reports.push({
          stage_id: stage.id,
          attempt: stdoutPath.match(/attempt-(\d+)/)?.[1] || 'legacy',
          provenance: 'unavailable',
          cost_usd: null,
          input_tokens: null,
          output_tokens: null,
          cached_tokens: null,
        });
        continue;
      }
      reports += 1;
      inputTokens += Number(usage.input_tokens || 0);
      outputTokens += Number(usage.output_tokens || 0);
      cachedTokens += Number(usage.cached_tokens || 0);
      if (typeof usage.cost_usd === 'number') {
        costUsd += usage.cost_usd;
        costReports += 1;
      }
      totals.stage_reports.push({
        stage_id: stage.id,
        attempt: stdoutPath.match(/attempt-(\d+)/)?.[1] || 'legacy',
        provenance: usage.provenance,
        cost_usd: usage.cost_usd,
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
        cached_tokens: usage.cached_tokens ?? null,
      });
    }
  }
  if (attempts > 0 && reports === attempts) {
    totals.input_tokens = inputTokens;
    totals.output_tokens = outputTokens;
    totals.cached_tokens = cachedTokens;
  }
  totals.cost_usd = attempts > 0 && costReports === attempts
    ? Number(costUsd.toFixed(6))
    : null;
  totals.cost_availability = attempts > 0 && costReports === attempts
    ? 'reported'
    : (costReports > 0 ? 'partial' : 'unavailable');
  totals.availability = attempts > 0 && reports === attempts
    ? 'reported'
    : (reports > 0 ? 'partial' : 'unavailable');
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
      cost_availability: totals.cost_availability,
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

function collectQuickViewArtifacts(runDir, reportArtifacts) {
  const workspace = join(runDir, 'workspace');
  // 优先选择可直接在浏览器运行的构建产物；workspace/index.html 往往是源码入口，
  // 可能引用 TypeScript，不能作为最终交付页直接打开。
  const deliveryPage = [
    join(workspace, 'dist', 'index.html'),
    join(workspace, 'candidate-delivery', 'index.html'),
    join(workspace, 'index.html'),
  ].find(existsSync);
  const candidates = [
    ['评测报告（HTML）', reportArtifacts[0]],
    ...(deliveryPage ? [['最终交付网页（构建产物）', deliveryPage]] : []),
    ['候选交付说明', join(workspace, 'candidate-delivery.md')],
    ['自动化测试结果', join(workspace, 'automated-test-results.md')],
    ['性能证据', join(workspace, 'performance-evidence.md')],
    ['需求 Ledger', join(workspace, 'requirement-ledger.yaml')],
    ['视觉走查版本', join(workspace, 'reviewable-poc-v2', 'index.html')],
    ['交互扩展版本', join(workspace, 'interaction-demo', 'index.html')],
  ];
  return candidates
    .filter(([, path]) => existsSync(path))
    .map(([label, path]) => ({ label, path, url: pathToFileURL(path).href }));
}

function printQuickViewArtifacts(items) {
  if (items.length === 0) return;
  process.stderr.write('[VAB] 直接查看：\n');
  for (const item of items) {
    process.stderr.write(`[VAB] ${item.label}：${item.url}\n`);
  }
}

function resolveResumeRun(value) {
  const direct = resolve(value);
  if (existsSync(direct)) return direct;
  const byId = join(projectRoot, '.local', 'runs', value);
  if (existsSync(byId)) return byId;
  throw new Error(`待恢复 Run 不存在：${value}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function resumeExistingRun(args) {
  const runDir = resolveResumeRun(String(args.resume_run));
  const specPath = join(runDir, 'run-spec.json');
  if (!existsSync(specPath)) throw new Error(`待恢复 Run 缺少 run-spec.json：${runDir}`);
  const storedSpec = readJson(specPath);
  const storedResult = existsSync(join(runDir, 'result.json')) ? readJson(join(runDir, 'result.json')) : null;
  const caseId = storedSpec.case_id || storedResult?.case_id;
  const model = storedSpec.engine?.configured_model || storedSpec.engine?.model
    || storedResult?.engine?.configured_model || storedResult?.engine?.model;
  const engine = storedSpec.engine?.adapter || storedResult?.engine?.adapter;
  if (!caseId || !model || !engine) throw new Error('待恢复 Run 缺少 case、engine 或 model，拒绝猜测配置。');
  const caseDir = join(projectRoot, 'cases', caseId);
  const caseMetaPath = join(caseDir, 'case.yaml');
  if (!existsSync(caseMetaPath)) throw new Error(`待恢复 Run 的 Case 不存在：${caseId}`);
  const caseMeta = parseYaml(readFileSync(caseMetaPath, 'utf8'));
  const isDevelopmentSmoke = caseMeta.task_type === 'development-smoke';
  const wallTimeMinutes = Number(storedSpec.budget?.wall_time_minutes || 180);
  const provider = storedSpec.engine?.provider || storedResult?.engine?.provider || 'unspecified';
  if (args.dry_run) {
    process.stdout.write(`${JSON.stringify({
      status: 'success',
      summary: '恢复配置解析成功；未调用模型。',
      resolved_config: { run_id: storedSpec.run_id || basename(runDir), case_id: caseId, engine, model, provider, wall_time_minutes: wallTimeMinutes },
      next_actions: ['移除 --dry-run 后从原 Run 的未完成阶段继续。'],
      artifacts: [join(runDir, 'run-spec.json'), join(runDir, 'result.json')],
    }, null, 2)}\n`);
    return;
  }
  process.stderr.write(
    `[VAB] 恢复 Run：${storedSpec.run_id || basename(runDir)}\n`
    + `[VAB] Run 目录：${runDir}\n`
    + `[VAB] 保留已完成阶段、workspace 和原生 Session；只执行未完成阶段。\n`
    + `[VAB] 另开终端观察：npm run bench:status -- --run ${storedSpec.run_id || basename(runDir)} --watch\n`,
  );
  writeJson(join(runDir, 'logs', 'real-smoke-resume.json'), {
    resumed_at: new Date().toISOString(),
    requested_via: 'bench:case --resume-run',
    configured_engine: engine,
    configured_model: model,
    configured_provider: provider,
  });
  const executed = await runNodeWithProgress(
    ['scripts/bench.mjs', 'run', '--run-dir', runDir],
    { runDir, timeout: wallTimeMinutes * 60_000 + 30_000 },
  );
  const usage = collectReportedUsage(runDir, caseDir);
  const outcome = createMachineEvidence(runDir, executed.envelope, caseDir, isDevelopmentSmoke);
  const report = generateReport(runDir, caseMeta, outcome);
  const quickView = collectQuickViewArtifacts(runDir, report.artifacts);
  printQuickViewArtifacts(quickView);
  process.stdout.write(`${JSON.stringify({
    status: outcome.flowPassed ? 'success' : 'warning',
    summary: outcome.flowPassed
      ? `${caseMeta.title} 已从原 Run 恢复完成；流程门禁通过${isDevelopmentSmoke ? '。' : '，业务验收仍待浏览器与人工评审。'}`
      : `${caseMeta.title} 已尝试从原 Run 恢复，但一个或多个流程门禁失败。`,
    next_actions: outcome.flowPassed
      ? [isDevelopmentSmoke ? '检查恢复后的模型事件和演示报告。' : '进入浏览器评审并补录人工评分、修改时间和最终验收结论。']
      : (outcome.providerFailure?.next_actions || ['检查 real-smoke-checkpoints.json 和恢复阶段的 stderr，修复根因后仅重试一次。']),
    artifacts: [...report.artifacts, ...quickView.map(item => item.path), join(runDir, 'logs', 'real-smoke-checkpoints.json'), ...(outcome.providerFailure ? [join(runDir, 'logs', 'provider-failure-diagnosis.json')] : []), join(runDir, 'logs', 'stages')],
    quick_view: quickView,
    run_id: storedSpec.run_id || basename(runDir),
    run_dir: runDir,
    resumed: true,
    case_id: caseId,
    case_title: caseMeta.title,
    configured_model: model,
    configured_provider: provider,
    reported_cost_usd: usage.cost_usd,
    reported_tokens: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cached_tokens: usage.cached_tokens },
    business_acceptance: outcome.businessAccepted === true ? 'accepted' : (isDevelopmentSmoke ? 'not-applicable' : 'pending-human-review'),
  }, null, 2)}\n`);
}

async function finalizeExistingRun(args) {
  const runDir = resolveResumeRun(String(args.finalize_run));
  const resultPath = join(runDir, 'result.json');
  const specPath = join(runDir, 'run-spec.json');
  if (!existsSync(resultPath) || !existsSync(specPath)) {
    throw new Error('待归档 Run 必须同时包含 result.json 和 run-spec.json。');
  }
  const storedResult = readJson(resultPath);
  const storedSpec = readJson(specPath);
  const caseId = storedSpec.case_id || storedResult.case_id;
  const caseDir = join(projectRoot, 'cases', caseId || '');
  const caseMetaPath = join(caseDir, 'case.yaml');
  if (!caseId || !existsSync(caseMetaPath)) throw new Error(`待归档 Run 的 Case 不存在：${caseId || 'unknown'}`);
  const caseMeta = parseYaml(readFileSync(caseMetaPath, 'utf8'));
  const isDevelopmentSmoke = caseMeta.task_type === 'development-smoke';
  const outcome = createMachineEvidence(runDir, { status: storedResult.status }, caseDir, isDevelopmentSmoke);
  const usage = collectReportedUsage(runDir, caseDir);
  const report = generateReport(runDir, caseMeta, outcome);
  const quickView = collectQuickViewArtifacts(runDir, report.artifacts);
  printQuickViewArtifacts(quickView);
  process.stdout.write(`${JSON.stringify({
    status: outcome.flowPassed ? 'success' : 'warning',
    summary: outcome.flowPassed
      ? `${caseMeta.title} 已根据既有 Runner 证据重新归档；未重新调用模型。`
      : `${caseMeta.title} 重新归档后仍有未通过的流程门禁。`,
    next_actions: outcome.flowPassed
      ? ['进入浏览器评审并补录人工评分、修改时间和最终验收结论。']
      : (outcome.providerFailure?.next_actions || ['检查 result.json 中失败阶段与 checkpoint gate 的根因。']),
    artifacts: [...report.artifacts, ...quickView.map(item => item.path), join(runDir, 'logs', 'real-smoke-checkpoints.json'), ...(outcome.providerFailure ? [join(runDir, 'logs', 'provider-failure-diagnosis.json')] : [])],
    quick_view: quickView,
    run_id: storedResult.run_id || storedSpec.run_id || basename(runDir),
    run_dir: runDir,
    finalized_without_model_call: true,
    reported_cost_usd: usage.cost_usd,
    reported_tokens: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cached_tokens: usage.cached_tokens },
    business_acceptance: isDevelopmentSmoke && outcome.businessAccepted ? 'accepted' : 'pending-human-review',
  }, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.resume_run) return resumeExistingRun(args);
  if (args.finalize_run) return finalizeExistingRun(args);
  if (args.help) {
    process.stdout.write(`${JSON.stringify({
      status: 'success',
      summary: '真实模型评测入口参数。',
      next_actions: [
        'node scripts/real-model-smoke-flow.mjs --case <id> --engine <codex|kimi|claude|pi> --model <id> [--dry-run]',
        'node scripts/real-model-smoke-flow.mjs --finalize-run <run-id|run-dir>  # 只重建后处理证据与报告，不调用模型',
      ],
      artifacts: [],
    }, null, 2)}\n`);
    return;
  }
  if (!['codex', 'claude', 'kimi', 'pi'].includes(args.engine)) {
    throw new Error('当前真实模型统一入口支持 --engine codex、--engine claude、--engine kimi 或 --engine pi。');
  }
  const provider = args.provider || ({
    codex: 'openai-codex-configured-provider',
    kimi: 'kimi-code-managed-provider',
    claude: 'claude-code-configured-provider',
    pi: 'pi-direct-api',
  }[args.engine]);
  const model = args.model || ({
    codex: 'gpt-5.6-sol',
    kimi: 'kimi-code/k3',
    claude: 'deepseek-v4-flash',
    pi: 'deepseek-chat',
  }[args.engine]);
  const modelProvider = args.engine === 'pi'
    ? (args.model_provider || 'deepseek')
    : null;
  if (args.model_provider && args.engine !== 'pi') {
    throw new Error('--model-provider 当前仅支持 Pi；例如 --engine pi --model-provider deepseek。');
  }
  const reasoningEffort = args.engine === 'codex' ? (args.reasoning_effort || 'medium') : null;
  if (args.reasoning_effort && args.engine !== 'codex') {
    throw new Error('--reasoning-effort 当前仅支持 Codex；Claude、Kimi 和 Pi 不接受该参数。');
  }
  if (reasoningEffort && !['low', 'medium', 'high', 'xhigh'].includes(reasoningEffort)) {
    throw new Error('--reasoning-effort 只支持 low、medium、high 或 xhigh。');
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
  if (args.engine === 'claude' && !isDevelopmentSmoke && maxStageCostUsd == null && !args.dry_run) {
    throw new Error('正式 Case 必须显式设置 --max-stage-cost-usd，避免无人值守运行失控。');
  }
  if (['kimi', 'codex', 'pi'].includes(args.engine) && args.max_stage_cost_usd != null) {
    const label = { kimi: 'Kimi Code', codex: 'Codex', pi: 'Pi' }[args.engine];
    throw new Error(`${label} CLI 不支持原生费用上限，请移除 --max-stage-cost-usd，并显式传入 --acknowledge-no-cost-cap。`);
  }
  if (['kimi', 'codex', 'pi'].includes(args.engine) && !args.acknowledge_no_cost_cap && !args.dry_run) {
    const label = { kimi: 'Kimi Code', codex: 'Codex', pi: 'Pi' }[args.engine];
    throw new Error(`${label} CLI 不支持原生费用上限；真实运行必须显式传入 --acknowledge-no-cost-cap。`);
  }
  const effectiveMaxStageCostUsd = args.engine === 'claude' ? maxStageCostUsd : null;

  const resolvedConfig = {
    case_id: caseId,
    case_title: caseMeta.title,
    task_type: caseMeta.task_type,
    engine: args.engine,
    model,
    provider,
    workspace_source: workspaceSource,
    stage_count: stageCount,
    wall_time_minutes: Number(wallTimeMinutes),
    max_stage_cost_usd: effectiveMaxStageCostUsd === 'none' || effectiveMaxStageCostUsd == null
      ? null
      : Number(effectiveMaxStageCostUsd),
    max_possible_run_cost_usd: effectiveMaxStageCostUsd === 'none' || effectiveMaxStageCostUsd == null
      ? null
      : Number(effectiveMaxStageCostUsd) * stageCount,
    cost_cap_enforcement: args.engine === 'claude' ? 'native-cli-per-stage' : 'unavailable',
    permission_mode: args.engine === 'codex'
      ? 'exec-noninteractive-workspace-write'
      : (args.engine === 'kimi' ? 'prompt-mode-auto' : (args.engine === 'pi' ? 'approve-restricted-tools' : 'auto')),
    reasoning_effort: reasoningEffort,
    model_provider: modelProvider,
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
    '--model', model,
    '--provider', provider,
    ...(modelProvider ? ['--model-provider', modelProvider] : []),
    ...(reasoningEffort ? ['--reasoning-effort', reasoningEffort] : []),
    '--wall-time-minutes', wallTimeMinutes,
    '--workspace-source', workspaceSource,
  ];
  if (effectiveMaxStageCostUsd != null && effectiveMaxStageCostUsd !== 'none') {
    prepareArgs.push('--max-cost-usd', effectiveMaxStageCostUsd);
  }

  const prepared = runNode(prepareArgs);
  if (prepared.envelope.status !== 'success') {
    throw new Error(`Prepare failed: ${prepared.envelope.summary}`);
  }
  const runDir = prepared.envelope.run_dir;
  process.stderr.write(
    `[VAB] Run 已创建：${prepared.envelope.run_id}\n`
    + `[VAB] Run 目录：${runDir}\n`
    + `[VAB] 独立工作区：${join(runDir, 'workspace')}\n`
    + `[VAB] 另开终端观察：npm run bench:status -- --run ${prepared.envelope.run_id} --watch\n`,
  );
  writeJson(join(runDir, 'logs', 'real-smoke-orchestrator.json'), {
    mode: isDevelopmentSmoke ? 'real-model-development-smoke' : 'real-model-case-benchmark',
    ...resolvedConfig,
    started_at: new Date().toISOString(),
  });

  const executed = await runNodeWithProgress(
    ['scripts/bench.mjs', 'run', '--run-dir', runDir],
    { runDir, timeout: Number(wallTimeMinutes) * 60_000 + 30_000 },
  );
  const usage = collectReportedUsage(runDir, caseDir);
  const outcome = createMachineEvidence(runDir, executed.envelope, caseDir, isDevelopmentSmoke);
  const report = generateReport(runDir, caseMeta, outcome);
  const quickView = collectQuickViewArtifacts(runDir, report.artifacts);
  printQuickViewArtifacts(quickView);

  process.stdout.write(`${JSON.stringify({
    status: outcome.flowPassed ? 'success' : 'warning',
    summary: outcome.flowPassed
      ? `${caseMeta.title} 已使用 ${model} 跑完；流程门禁通过${isDevelopmentSmoke ? '。' : '，业务验收仍待浏览器与人工评审。'}`
      : `${caseMeta.title} 已使用 ${model} 运行，但一个或多个流程门禁失败。`,
    next_actions: outcome.flowPassed
      ? [isDevelopmentSmoke
        ? '检查模型事件和演示报告；该运行不可用于正式排行榜结论。'
        : '进入浏览器评审并补录人工评分、修改时间和最终验收结论。']
      : (outcome.providerFailure?.next_actions || ['检查 real-smoke-checkpoints.json 和各阶段 stderr，修复根因后仅重试一次。']),
    artifacts: [
      ...report.artifacts,
      ...quickView.map(item => item.path),
      join(runDir, 'logs', 'real-smoke-checkpoints.json'),
      ...(outcome.providerFailure ? [join(runDir, 'logs', 'provider-failure-diagnosis.json')] : []),
      join(runDir, 'logs', 'stages'),
    ],
    quick_view: quickView,
    run_id: prepared.envelope.run_id,
    run_dir: runDir,
    case_id: caseId,
    case_title: caseMeta.title,
    configured_model: model,
    configured_provider: provider,
    configured_stage_cost_cap_usd: effectiveMaxStageCostUsd === 'none'
      ? null
      : (effectiveMaxStageCostUsd == null ? null : Number(effectiveMaxStageCostUsd)),
    cost_cap_enforcement: resolvedConfig.cost_cap_enforcement,
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

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
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
});
