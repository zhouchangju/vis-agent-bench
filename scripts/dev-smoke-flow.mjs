#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out-dir') {
      args.outDir = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`);
}

function listFiles(root, prefix = '') {
  if (!existsSync(root)) return [];
  const files = [];
  for (const name of readdirSync(root).sort()) {
    if (name === '.git') continue;
    const absolute = join(root, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (statSync(absolute).isDirectory()) files.push(...listFiles(absolute, relative));
    else files.push(relative);
  }
  return files;
}

function stagePrompt(stage) {
  const content = stage.input
    ? readFileSync(join(caseDir, 'scenario', stage.input), 'utf8').trim()
    : stage.stakeholder_message.trim();
  return `${content}

## 本阶段交付协议

当前阶段：${stage.id} / ${stage.name}
这是无人值守开发冒烟流程，不要等待实时确认。
更新 requirement-ledger.yaml，并生成 checkpoint：${stage.checkpoint.join('、')}。
结束时输出 status、summary、next_actions、artifacts。
`;
}

function writeS0(workspace) {
  writeText(join(workspace, 'requirement-ledger.yaml'), `must: []
should: []
may: []
decisions:
  - id: D-001
    statement: 使用无依赖原生网页完成最小 POC
assumptions:
  - id: A-001
    statement: 文案和状态值等待下一阶段确认
open_questions:
  - 标题和数值是什么？
  - 初始状态是什么？
`);
  writeText(join(workspace, 'docs', 'poc-plan.md'), `# POC Plan

1. 确认固定文案与初始状态；
2. 创建无依赖状态卡片；
3. 根据走查反馈补交互和测试证据。
`);
}

function writeS1(workspace) {
  writeText(join(workspace, 'requirement-ledger.yaml'), `must:
  - id: R-001
    statement: 标题为 Pipeline Health
    source_stage: S1
    status: implemented
    evidence: index.html
  - id: R-002
    statement: 数值为 3 / 3 stages，初始状态为 ready
    source_stage: S1
    status: implemented
    evidence: index.html
should: []
may: []
decisions:
  - id: D-001
    statement: 使用无依赖原生网页完成最小 POC
assumptions: []
open_questions: []
`);
  writeText(join(workspace, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Pipeline Health</title></head>
<body>
  <main>
    <section id="status-card" data-status="ready">
      <h1 id="smoke-title">Pipeline Health</h1>
      <p id="smoke-value">3 / 3 stages</p>
    </section>
  </main>
  <script type="module" src="./app.js"></script>
</body>
</html>
`);
  writeText(join(workspace, 'app.js'), `export function currentStatus(card) {
  return card.dataset.status;
}
`);
  writeJson(join(workspace, 'artifacts', 'poc.json'), {
    status: 'success',
    summary: 'Static status card created.',
    next_actions: ['Apply stakeholder interaction feedback.'],
    artifacts: ['index.html', 'app.js'],
  });
}

function writeS2(workspace) {
  writeText(join(workspace, 'requirement-ledger.yaml'), `must:
  - id: R-001
    statement: 标题为 Pipeline Health
    source_stage: S1
    status: implemented
    evidence: index.html
  - id: R-002
    statement: 数值为 3 / 3 stages，初始状态为 ready
    source_stage: S1
    status: implemented
    evidence: index.html
  - id: R-003
    statement: 按钮在 ready 与 paused 间切换并同步 data-status
    source_stage: S2
    status: implemented
    evidence: app.js
should: []
may: []
decisions:
  - id: D-001
    statement: 使用无依赖原生网页完成最小 POC
assumptions: []
open_questions: []
`);
  writeText(join(workspace, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Pipeline Health</title></head>
<body>
  <main>
    <section id="status-card" data-status="ready">
      <h1 id="smoke-title">Pipeline Health</h1>
      <p id="smoke-value">3 / 3 stages</p>
      <button id="toggle-status" type="button">Toggle status</button>
    </section>
  </main>
  <script type="module" src="./app.js"></script>
</body>
</html>
`);
  writeText(join(workspace, 'app.js'), `export function toggleStatus(card) {
  const next = card.dataset.status === 'ready' ? 'paused' : 'ready';
  card.dataset.status = next;
  return next;
}

const card = document.querySelector('#status-card');
const button = document.querySelector('#toggle-status');
if (card && button) button.addEventListener('click', () => toggleStatus(card));
`);
  writeText(join(workspace, 'tests', 'smoke.mjs'), `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
for (const expected of ['status-card', 'smoke-title', 'smoke-value', 'toggle-status', 'Pipeline Health', '3 / 3 stages']) {
  assert.ok(html.includes(expected), \`missing \${expected}\`);
}
assert.match(app, /ready/);
assert.match(app, /paused/);
process.stdout.write('smoke fixture passed\\n');
`);
  writeJson(join(workspace, 'artifacts', 'smoke-result.json'), {
    status: 'success',
    summary: 'Status card selectors, copy, and toggle implementation verified.',
    next_actions: [],
    artifacts: ['tests/smoke.mjs'],
  });
}

const stageWriters = { S0: writeS0, S1: writeS1, S2: writeS2 };

function runStage({ runDir, workspace, stage, sequence }) {
  const inputPath = join(runDir, 'input', `stage-${stage.id}.md`);
  const logsDir = join(runDir, 'logs', 'stages', stage.id);
  mkdirSync(logsDir, { recursive: true });
  writeText(inputPath, stagePrompt(stage));
  const before = listFiles(workspace);
  const startedAt = new Date().toISOString();
  stageWriters[stage.id](workspace);
  const after = listFiles(workspace);
  const changed = after.filter(file => !before.includes(file));
  const missing = stage.checkpoint.filter(path => !existsSync(join(workspace, path)));
  const status = missing.length ? 'error' : 'success';
  const events = [
    { ts: startedAt, seq: sequence, source: 'mock', type: 'stage.started', stage_id: stage.id, status: 'success' },
    { ts: startedAt, seq: sequence + 1, source: 'mock', type: 'assistant.message', stage_id: stage.id, status: 'success', summary: `Applied deterministic ${stage.id} output.` },
    { ts: startedAt, seq: sequence + 2, source: 'mock', type: 'file.changed', stage_id: stage.id, status: 'success', artifacts: changed },
    { ts: startedAt, seq: sequence + 3, source: 'runner', type: 'stage.checkpoint', stage_id: stage.id, status, artifacts: stage.checkpoint },
    { ts: new Date().toISOString(), seq: sequence + 4, source: 'runner', type: 'stage.ended', stage_id: stage.id, status },
  ];
  const jsonl = `${events.map(event => JSON.stringify(event)).join('\n')}\n`;
  writeText(join(logsDir, 'stdout.raw'), JSON.stringify({
    status,
    summary: `Mock stage ${stage.id} completed.`,
    next_actions: missing.length ? ['Create missing checkpoints and retry.'] : [],
    artifacts: stage.checkpoint,
  }));
  writeText(join(logsDir, 'stderr.raw'), '');
  writeText(join(logsDir, 'events.jsonl'), jsonl);
  writeText(join(logsDir, 'normalized-events.jsonl'), jsonl);
  writeJson(join(logsDir, 'files-before.json'), before);
  writeJson(join(logsDir, 'files-after.json'), after);
  writeJson(join(logsDir, 'checkpoint.json'), {
    status,
    expected: stage.checkpoint,
    missing,
    root_cause_hint: missing.length ? `Missing ${missing.join(', ')}` : null,
    safe_retry: missing.length ? 'Run the same deterministic stage once more.' : null,
    stop_condition: missing.length ? 'Stop after the same checkpoint is missing twice.' : null,
  });
  if (missing.length) throw new Error(`Stage ${stage.id} checkpoint failed: ${missing.join(', ')}`);
  return {
    stage_id: stage.id,
    status,
    duration_ms: 1,
    checkpoint_status: status,
    artifacts: stage.checkpoint,
  };
}

function createRunDir(outDirArg) {
  if (outDirArg) {
    const requested = resolve(outDirArg);
    mkdirSync(requested, { recursive: true });
    return requested;
  }
  const smokeRoot = join(projectRoot, '.local', 'smoke');
  mkdirSync(smokeRoot, { recursive: true });
  return mkdtempSync(join(smokeRoot, 'dev-flow-'));
}

function main() {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const runDir = createRunDir(args.outDir);
  const workspace = join(runDir, 'workspace');
  for (const dir of ['input', 'logs', 'artifacts', 'reports']) {
    mkdirSync(join(runDir, dir), { recursive: true });
  }
  cpSync(join(caseDir, 'fixture'), workspace, { recursive: true });

  const scenario = parseYaml(readFileSync(join(caseDir, 'scenario', 'stages.yaml'), 'utf8'));
  const runId = basename(runDir);
  const runSpec = {
    schema_version: 2,
    run_id: runId,
    case_id: caseId,
    status: 'running',
    mode: 'development-smoke',
    engine: {
      adapter: 'mock',
      provider: 'development',
      configured_model: 'deterministic-mock-agent',
      permission_mode: 'none',
    },
    isolation: {
      mode: 'development-smoke',
      leaderboard_eligible: false,
      network: false,
    },
    scenario: {
      mode: scenario.mode,
      stage_ids: scenario.stages.map(stage => stage.id),
    },
  };
  writeJson(join(runDir, 'run-spec.json'), runSpec);
  writeJson(join(runDir, 'logs', 'files-before.json'), listFiles(workspace));

  const stageResults = scenario.stages.map((stage, index) =>
    runStage({ runDir, workspace, stage, sequence: index * 10 + 1 }));

  const fixtureTest = spawnSync(
    process.execPath,
    ['tests/smoke.mjs'],
    { cwd: workspace, encoding: 'utf8', shell: false },
  );
  writeText(join(runDir, 'logs', 'fixture-test.stdout'), fixtureTest.stdout);
  writeText(join(runDir, 'logs', 'fixture-test.stderr'), fixtureTest.stderr);
  if (fixtureTest.status !== 0) throw new Error(`Smoke fixture test failed: ${fixtureTest.stderr}`);

  const result = {
    status: 'success',
    run_id: runId,
    case_id: caseId,
    duration_ms: Date.now() - started,
    stages: stageResults,
    engine: runSpec.engine,
    isolation: runSpec.isolation,
    usage: { availability: 'unavailable' },
    human_review_status: 'complete',
    completed_at: new Date().toISOString(),
  };
  writeJson(join(runDir, 'result.json'), result);
  writeJson(join(runDir, 'evaluator-summary.json'), {
    status: 'success',
    summary: { p0_passed: true, score: 100, p0_min_score: 80 },
    checks: [
      { id: 'stages', status: 'pass', evidence: stageResults.map(stage => stage.stage_id) },
      { id: 'fixture-test', status: 'pass', evidence: ['logs/fixture-test.stdout'] },
    ],
  });
  writeJson(join(runDir, 'human-review.json'), {
    schema_version: 2,
    run_id: runId,
    reviewer: 'development-smoke-fixture',
    isolation: 'development-smoke',
    machine_evidence_ref: 'browser-evidence.json',
    blind_review: false,
    reviewed_at: new Date().toISOString(),
    reviews: [{
      case_id: caseId,
      complete: true,
      decision: 'accepted',
      scores: { business: 5, visual: 5, interaction: 5, usability: 5 },
      human_time: {
        clarification_minutes: 0,
        context_prep_minutes: 0,
        poc_review_minutes: 0,
        micro_adjustment_minutes: 0,
        fix_minutes: 0,
        final_review_minutes: 0,
      },
      convergence: {
        clarification_rounds: 0,
        iterations_to_acceptance: 1,
        micro_adjustment_items: 1,
        must_have_misses: 0,
        requirement_regressions: 0,
        first_poc_fitness_percent: 100,
      },
      observations: {
        strengths: '确定性的开发流程已完整跑通。',
        problems: '该 Mock 运行不能证明真实模型或真实浏览器行为。',
        required_fixes: '',
        management_judgment: '仅用于 DEMO，不得用于模型能力或提效结论。',
      },
    }],
  });
  writeJson(join(runDir, 'isolation.json'), {
    mode: 'development-smoke',
    leaderboard_eligible: false,
    network: false,
    note: '确定性 Mock 运行，未启动模型进程。',
  });
  writeJson(join(runDir, 'browser-evidence.json'), {
    status: 'success',
    driver: 'development-static-check',
    canvas_webgl_proven: false,
    artifacts: ['workspace/index.html'],
  });
  writeJson(join(runDir, 'logs', 'files-after.json'), listFiles(workspace));

  const entry = loadEntry(runDir, {
    demo: true,
    caseMeta: { title: '开发流程状态卡片 Smoke' },
  });
  const report = buildReport({
    entries: [entry],
    reportId: `report-${runId}`,
    generatedAt: new Date().toISOString(),
    title: '开发流程 Smoke 报告',
  });
  const validation = validateReport(report);
  if (!validation.valid) {
    throw new Error(`Generated report is invalid: ${JSON.stringify(validation.errors.slice(0, 3))}`);
  }
  const reportJson = join(runDir, 'reports', 'report.json');
  const reportMarkdown = join(runDir, 'reports', 'report.md');
  const reportHtml = join(runDir, 'reports', 'report.html');
  writeJson(reportJson, report);
  writeText(reportMarkdown, renderMarkdown(report));
  writeText(reportHtml, renderHtml(report));

  runSpec.status = 'completed';
  runSpec.completed_at = result.completed_at;
  writeJson(join(runDir, 'run-spec.json'), runSpec);

  process.stdout.write(`${JSON.stringify({
    status: 'success',
    summary: `开发流程 Smoke 已完成 ${scenario.stages.length} 个阶段，并生成演示报告。`,
    next_actions: ['修改编排代码后，打开 HTML 报告并检查阶段日志。'],
    artifacts: [reportHtml, reportJson, join(runDir, 'logs', 'stages')],
    run_id: runId,
    run_dir: runDir,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: 'error',
    summary: error.message,
    next_actions: ['检查最后完成的阶段，修复根因后再重试。'],
    artifacts: [],
  }, null, 2)}\n`);
  process.exitCode = 1;
}
