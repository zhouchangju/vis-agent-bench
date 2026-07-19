#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { getAdapter, listAdapters } from '../src/runners/adapters.mjs';
import {
  copyWorkspaceSource,
  createRunLayout,
  listFiles,
  scanForAnswerLeakage,
} from '../src/core/file-isolation.mjs';
import { detectExecutable, runCommand } from '../src/core/process-runner.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (!value.startsWith('--')) parsed._.push(value);
    else {
      const key = value.slice(2).replaceAll('-', '_');
      const next = args[i + 1];
      if (next == null || next.startsWith('--')) parsed[key] = true;
      else {
        parsed[key] = next;
        i += 1;
      }
    }
  }
  return parsed;
}

function output(status, summary, nextActions = [], artifacts = [], extra = {}) {
  process.stdout.write(`${JSON.stringify({
    status,
    summary,
    next_actions: nextActions,
    artifacts,
    ...extra,
  }, null, 2)}\n`);
}

function requireOption(args, key) {
  if (!args[key]) throw new Error(`Missing required option --${key.replaceAll('_', '-')}`);
  return args[key];
}

function loadScenario(caseDir) {
  const path = join(caseDir, 'scenario', 'stages.yaml');
  if (!existsSync(path)) throw new Error(`Missing staged scenario: ${path}`);
  const scenario = parseYaml(readFileSync(path, 'utf8'));
  if (!Array.isArray(scenario.stages) || scenario.stages.length === 0) {
    throw new Error(`Scenario has no stages: ${path}`);
  }
  return scenario;
}

function stagePrompt(caseDir, scenario, stage) {
  const content = stage.input
    ? readFileSync(join(caseDir, 'scenario', stage.input), 'utf8')
    : stage.stakeholder_message;
  const developmentSmokeRules = basename(caseDir) === 'dev-workflow-smoke'
    ? [
        '这是开发管道 Smoke：禁止启动子 Agent、后台任务和联网。',
        '不要扩展需求或过度设计；直接完成 checkpoint，使用尽可能少的工具调用。',
        '本阶段最多进行一次必要的本地验证，不要反复自检。',
      ]
    : [];
  return [
    content.trim(),
    '',
    '## 本阶段交付协议',
    '',
    `当前阶段：${stage.id} / ${stage.name}`,
    '只处理当前已知信息，不要猜测后续需求。',
    '更新 workspace 根目录的 requirement-ledger.yaml，保持内容短小并标注 must/should/may、决策、假设和待确认项。',
    `本阶段 checkpoint：${(stage.checkpoint || []).join('、')}`,
    ...developmentSmokeRules,
    '结束时简要输出：status、summary、next_actions、artifacts。',
    '',
  ].join('\n');
}

function findSessionId(rawPath) {
  const lines = readFileSync(rawPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const id = event.thread_id || event.session_id || event.sessionId
        || event.data?.thread_id || event.data?.session_id || event.data?.sessionId;
      if (typeof id === 'string' && id.length > 8) return id;
    } catch {
      // Ignore non-JSON output.
    }
  }
  return null;
}

async function doctor() {
  const engines = listAdapters().map(adapter =>
    ({ id: adapter.id, ...detectExecutable(adapter.executable, adapter.versionArgs) }));
  const unavailable = engines.filter(engine => !engine.available);
  output(
    unavailable.length ? 'warning' : 'success',
    `${engines.length - unavailable.length}/${engines.length} CLI engine(s) available.`,
    unavailable.map(engine => `Configure executable for ${engine.id}.`),
    [],
    { engines },
  );
}

function prepare(args) {
  const caseId = requireOption(args, 'case');
  const engine = requireOption(args, 'engine');
  const model = requireOption(args, 'model');
  getAdapter(engine);

  const caseDir = join(projectRoot, 'cases', caseId);
  if (!existsSync(caseDir)) throw new Error(`Unknown case: ${caseId}`);
  const scenario = loadScenario(caseDir);

  const runId = args.run_id || `${new Date().toISOString().replaceAll(/[:.]/g, '-')}_${engine}_${randomUUID().slice(0, 8)}`;
  const runDir = createRunLayout(projectRoot, runId);
  const firstStage = scenario.stages[0];
  writeFileSync(
    join(runDir, 'input', `stage-${firstStage.id}.md`),
    stagePrompt(caseDir, scenario, firstStage),
  );
  if (args.workspace_source) {
    copyWorkspaceSource(resolve(args.workspace_source), join(runDir, 'workspace'));
  } else {
    writeFileSync(
      join(runDir, 'workspace', 'README.md'),
      `# Empty benchmark workspace\n\nCase: ${caseId}\n`,
    );
  }

  const leakage = scanForAnswerLeakage(caseId, join(runDir, 'workspace'));
  writeFileSync(join(runDir, 'logs', 'leakage-scan.json'), JSON.stringify(leakage, null, 2));
  if (leakage.length) {
    output(
      'error',
      `Answer leakage scan found ${leakage.length} issue(s); run was not prepared.`,
      ['Use a sanitized scaffold without existing implementation or Git history.'],
      [join(runDir, 'logs', 'leakage-scan.json')],
      { run_id: runId, run_dir: runDir },
    );
    process.exitCode = 2;
    return;
  }

  const spec = {
    schema_version: 2,
    run_id: runId,
    case_id: caseId,
    status: 'prepared',
    scenario: {
      mode: scenario.mode,
      stage_ids: scenario.stages.map(stage => stage.id),
      current_stage: null,
      completed_stages: [],
      future_stage_inputs_copied: false,
    },
    isolation: {
      mode: 'file-isolated-development',
      leaderboard_eligible: false,
      workspace_source: args.workspace_source ? basename(resolve(args.workspace_source)) : 'empty',
      inherited_home_for_auth: true,
    },
    engine: {
      adapter: engine,
      executable: args.executable || getAdapter(engine).executable,
      model,
      provider: args.provider || 'unspecified',
      reasoning_effort: args.reasoning_effort || null,
    },
    budget: {
      wall_time_minutes: Number(args.wall_time_minutes || 180),
      max_cost_usd: args.max_cost_usd == null ? null : Number(args.max_cost_usd),
    },
    evidence: {
      raw_logs: true,
      normalized_events: true,
      file_snapshots: true,
      git_diff: true,
      human_review_required: true,
    },
    session: {
      id: engine === 'claude' ? randomUUID() : null,
      continuity: getAdapter(engine).session_continuity,
      started: false,
    },
  };

  writeFileSync(join(runDir, 'run-spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(
    join(runDir, 'logs', 'files-before.json'),
    JSON.stringify(listFiles(join(runDir, 'workspace')), null, 2),
  );
  spawnSync('git', ['init', '-q'], { cwd: join(runDir, 'workspace'), shell: false });
  spawnSync('git', ['add', '.'], { cwd: join(runDir, 'workspace'), shell: false });
  spawnSync('git', ['-c', 'user.name=vis-agent-bench', '-c', 'user.email=bench@local', 'commit', '-qm', 'benchmark baseline'], {
    cwd: join(runDir, 'workspace'),
    shell: false,
  });

  output(
    'success',
    `Prepared file-isolated development run ${runId}.`,
    [`Run: node scripts/bench.mjs run --run-dir "${runDir}"`],
    [
      join(runDir, 'run-spec.json'),
      join(runDir, 'input', `stage-${firstStage.id}.md`),
      join(runDir, 'logs', 'leakage-scan.json'),
    ],
    { run_id: runId, run_dir: runDir },
  );
}

async function run(args) {
  const runDir = resolve(requireOption(args, 'run_dir'));
  const specPath = join(runDir, 'run-spec.json');
  if (!existsSync(specPath)) throw new Error(`Missing run spec: ${specPath}`);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  if (spec.status !== 'prepared') throw new Error(`Run status must be prepared, got ${spec.status}`);

  const leakage = scanForAnswerLeakage(spec.case_id, join(runDir, 'workspace'));
  if (leakage.length) throw new Error(`Preflight failed: ${leakage.length} answer leakage finding(s)`);

  const adapter = getAdapter(spec.engine.adapter);
  spec.status = 'running';
  spec.started_at = new Date().toISOString();
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  const caseDir = join(projectRoot, 'cases', spec.case_id);
  const scenario = loadScenario(caseDir);
  const stageResults = [];
  const commandLogs = [];
  const runStarted = Date.now();

  for (const stage of scenario.stages) {
    const elapsed = Date.now() - runStarted;
    const remaining = spec.budget.wall_time_minutes * 60_000 - elapsed;
    if (remaining <= 0) {
      stageResults.push({ stage_id: stage.id, status: 'error', error: 'run budget exhausted' });
      break;
    }

    const inputPath = join(runDir, 'input', `stage-${stage.id}.md`);
    writeFileSync(inputPath, stagePrompt(caseDir, scenario, stage));
    const stageLogs = join(runDir, 'logs', 'stages', stage.id);
    mkdirSync(stageLogs, { recursive: true });
    spec.scenario.current_stage = stage.id;
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const command = adapter.build(spec, runDir, stage.id, spec.session);
    commandLogs.push({
      stage_id: stage.id,
      executable: command.executable,
      args: command.args.map(arg => arg.includes(readFileSync(inputPath, 'utf8')) ? '<PROMPT>' : arg),
      cwd: join(runDir, 'workspace'),
      isolation: spec.isolation,
    });
    const result = await runCommand({
      runId: spec.run_id,
      engine: spec.engine.adapter,
      command,
      cwd: join(runDir, 'workspace'),
      logsDir: stageLogs,
      timeoutMs: remaining,
      stageId: stage.id,
      env: {
        ...process.env,
        VIS_AGENT_BENCH_RUN_ID: spec.run_id,
        VIS_AGENT_BENCH_STAGE_ID: stage.id,
        VIS_AGENT_BENCH_ISOLATION: 'file-isolated-development',
      },
    });
    stageResults.push({ stage_id: stage.id, ...result });

    if (!spec.session.started) {
      spec.session.started = true;
      if (!spec.session.id) spec.session.id = findSessionId(result.stdoutPath);
      if (spec.engine.adapter === 'codex' && !spec.session.id) {
        spec.session.continuity = 'synthetic-checkpoint';
      }
    }
    if (result.status !== 'success') break;
    spec.scenario.completed_stages.push(stage.id);
  }
  writeFileSync(join(runDir, 'logs', 'commands.json'), JSON.stringify(commandLogs, null, 2));
  const result = {
    status: stageResults.length === scenario.stages.length
      && stageResults.every(stage => stage.status === 'success') ? 'success' : 'error',
    duration_ms: Date.now() - runStarted,
    stages: stageResults,
    session: spec.session,
  };

  const filesAfter = listFiles(join(runDir, 'workspace'));
  writeFileSync(join(runDir, 'logs', 'files-after.json'), JSON.stringify(filesAfter, null, 2));
  const status = spawnSync('git', ['status', '--short'], {
    cwd: join(runDir, 'workspace'),
    encoding: 'utf8',
    shell: false,
  });
  writeFileSync(join(runDir, 'logs', 'git-status.txt'), status.stdout || '');
  spawnSync('git', ['add', '-N', '.'], {
    cwd: join(runDir, 'workspace'),
    shell: false,
  });
  const diff = spawnSync('git', ['diff', '--binary', '--no-ext-diff'], {
    cwd: join(runDir, 'workspace'),
    encoding: 'utf8',
    shell: false,
  });
  writeFileSync(join(runDir, 'artifacts', 'workspace.diff'), diff.stdout || '');

  const finalResult = {
    ...result,
    run_id: spec.run_id,
    case_id: spec.case_id,
    engine: spec.engine,
    isolation: spec.isolation,
    human_review_status: 'pending',
    completed_at: new Date().toISOString(),
  };
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(finalResult, null, 2));
  spec.status = result.status === 'success' ? 'awaiting-human-review' : 'run-failed';
  spec.completed_at = finalResult.completed_at;
  writeFileSync(specPath, JSON.stringify(spec, null, 2));

  output(
    result.status,
    result.status === 'success'
      ? 'CLI run completed; machine evidence is ready for human review.'
      : 'CLI run failed; evidence was preserved for diagnosis.',
    ['Review artifacts and complete human-review.json before generating the final report.'],
    [
      join(runDir, 'result.json'),
      join(runDir, 'logs', 'stages'),
      join(runDir, 'logs', 'git-status.txt'),
      join(runDir, 'artifacts', 'workspace.diff'),
    ],
    { run_id: spec.run_id, run_dir: runDir },
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'doctor') return doctor();
  if (command === 'prepare') return prepare(args);
  if (command === 'run') return run(args);
  output(
    'error',
    'Unknown or missing command.',
    [
      'node scripts/bench.mjs doctor',
      'node scripts/bench.mjs prepare --case <id> --engine <codex|kimi|claude> --model <id> [--workspace-source <path>]',
      'node scripts/bench.mjs run --run-dir <path>',
    ],
  );
  process.exitCode = 1;
}

main().catch(error => {
  output('error', error.message, ['Fix the reported issue and retry; stop after two identical failures.']);
  process.exitCode = 1;
});
