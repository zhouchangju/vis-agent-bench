#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { getAdapter, listAdapters } from '../src/runners/adapters.mjs';
import { validateRunSpec } from '../src/contracts/index.mjs';
import { getCaseRuntime } from '../src/control-plane/case-registry.mjs';
import { runGoldenPipeline } from '../src/control-plane/pipeline.mjs';
import { buildHumanReviewPackage } from '../src/review/human-review-package.mjs';
import { aggregateUsage, normalizeStdout } from '../src/telemetry/index.mjs';
import {
  adapterId,
  buildRunSpec,
  loadRunSpec,
} from '../src/control-plane/run-spec.mjs';
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
  const engine = adapterId(requireOption(args, 'engine'));
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
    const runtime = getCaseRuntime(projectRoot, caseId);
    const built = spawnSync(process.execPath, [
      join(projectRoot, 'scripts', 'build-fixture.mjs'),
      '--case', caseId,
      '--source-root', runtime.starter,
      '--export-root', join(runDir, 'workspace'),
      '--plan', runtime.plan,
    ], { cwd: projectRoot, encoding: 'utf8', shell: false });
    if (built.status !== 0) {
      throw new Error(`Fixture build failed: ${(built.stderr || built.stdout || '').trim()}`);
    }
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

  const spec = buildRunSpec({
    name: args.name || `${caseId}-${engine}-${model}`,
    case_id: caseId,
    engine: {
      adapter: engine,
      executable: args.executable || getAdapter(engine).executable,
      configured_model: model,
      provider: args.provider || 'unspecified',
      credential_ref: args.credential_ref || `secret://${engine}/default`,
      reasoning_effort: args.reasoning_effort || null,
    },
    network: args.network !== 'disabled',
    block_internal_network: args.block_internal_network === true,
    workspace_root: join(runDir, 'workspace'),
    wall_time_minutes: args.wall_time_minutes,
    max_retries: args.max_retries,
    max_tokens: args.max_tokens,
    max_cost_usd: args.max_cost_usd,
  });
  const state = {
    schema_version: 1,
    run_id: runId,
    status: 'prepared',
    scenario: {
      mode: scenario.mode,
      stage_ids: scenario.stages.map(stage => stage.id),
      current_stage: null,
      completed_stages: [],
      attempts: {},
      future_stage_inputs_copied: false,
    },
    session: {
      id: engine === 'claude' ? randomUUID() : null,
      continuity: getAdapter(engine).session_continuity,
      started: false,
    },
  };

  writeFileSync(join(runDir, 'run-spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(runDir, 'run-state.json'), JSON.stringify(state, null, 2));
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
      join(runDir, 'run-state.json'),
      join(runDir, 'input', `stage-${firstStage.id}.md`),
      join(runDir, 'logs', 'leakage-scan.json'),
    ],
    { run_id: runId, run_dir: runDir },
  );
}

async function run(args) {
  const runDir = resolve(requireOption(args, 'run_dir'));
  const specPath = join(runDir, 'run-spec.json');
  const statePath = join(runDir, 'run-state.json');
  if (!existsSync(specPath)) throw new Error(`Missing run spec: ${specPath}`);
  if (!existsSync(statePath)) throw new Error(`Missing run state: ${statePath}`);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const specValidation = validateRunSpec(spec);
  if (!specValidation.valid) throw new Error(`RunSpec is invalid: ${JSON.stringify(specValidation.errors)}`);
  if (!['prepared', 'run-failed'].includes(state.status)) {
    throw new Error(`Run status must be prepared or run-failed, got ${state.status}`);
  }

  const leakage = scanForAnswerLeakage(spec.case_id, join(runDir, 'workspace'));
  if (leakage.length) throw new Error(`Preflight failed: ${leakage.length} answer leakage finding(s)`);

  const resolvedAdapterId = adapterId(spec.engine.adapter);
  const adapter = getAdapter(resolvedAdapterId);
  state.status = 'running';
  state.started_at = state.started_at || new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const caseDir = join(projectRoot, 'cases', spec.case_id);
  const scenario = loadScenario(caseDir);
  const stageResults = [];
  const commandLogPath = join(runDir, 'logs', 'commands.json');
  const commandLogs = existsSync(commandLogPath)
    ? JSON.parse(readFileSync(commandLogPath, 'utf8'))
    : [];
  const runStarted = Date.now();
  const completed = new Set(state.scenario.completed_stages);

  for (const stage of scenario.stages) {
    if (completed.has(stage.id)) {
      stageResults.push({ stage_id: stage.id, status: 'success', resumed_from_checkpoint: true });
      continue;
    }
    const elapsed = Date.now() - runStarted;
    const remaining = spec.budget.wall_time_minutes * 60_000 - elapsed;
    if (remaining <= 0) {
      stageResults.push({ stage_id: stage.id, status: 'error', error: 'run budget exhausted' });
      break;
    }

    const inputPath = join(runDir, 'input', `stage-${stage.id}.md`);
    writeFileSync(inputPath, stagePrompt(caseDir, scenario, stage));
    state.scenario.attempts = state.scenario.attempts || {};
    const attempt = (state.scenario.attempts[stage.id] || 0) + 1;
    state.scenario.attempts[stage.id] = attempt;
    const stageLogs = join(
      runDir,
      'logs',
      'stages',
      stage.id,
      `attempt-${String(attempt).padStart(2, '0')}`,
    );
    mkdirSync(stageLogs, { recursive: true });
    state.scenario.current_stage = stage.id;
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const executionSpec = {
      ...spec,
      engine: {
        ...spec.engine,
        adapter: resolvedAdapterId,
        model: spec.engine.configured_model,
      },
    };
    const command = adapter.build(executionSpec, runDir, stage.id, state.session);
    commandLogs.push({
      stage_id: stage.id,
      attempt,
      executable: command.executable,
      args: command.args.map(arg => arg.includes(readFileSync(inputPath, 'utf8')) ? '<PROMPT>' : arg),
      cwd: join(runDir, 'workspace'),
      isolation: spec.isolation,
    });
    const result = await runCommand({
      runId: state.run_id,
      engine: spec.engine.adapter,
      command,
      cwd: join(runDir, 'workspace'),
      logsDir: stageLogs,
      timeoutMs: remaining,
      stageId: stage.id,
      env: {
        ...process.env,
        VIS_AGENT_BENCH_RUN_ID: state.run_id,
        VIS_AGENT_BENCH_STAGE_ID: stage.id,
        VIS_AGENT_BENCH_ISOLATION: 'file-isolated-development',
      },
    });
    const rawStdout = readFileSync(result.stdoutPath, 'utf8');
    const normalized = normalizeStdout(rawStdout, {
      runId: state.run_id,
      source: resolvedAdapterId,
      stageId: stage.id,
    });
    const normalizedPath = result.normalized || join(stageLogs, 'normalized-events.jsonl');
    writeFileSync(
      normalizedPath,
      normalized.events.map(event => JSON.stringify(event)).join('\n')
        + (normalized.events.length ? '\n' : ''),
    );
    const stageUsage = aggregateUsage(normalized.events.map(event => event.data));
    stageResults.push({
      stage_id: stage.id,
      attempt,
      ...result,
      normalized: normalizedPath,
      usage: withUsageAvailability(stageUsage),
      telemetry: {
        event_count: normalized.events.length,
        truncated_lines: normalized.stats.truncated,
        unknown_event_types: [...normalized.stats.unknown_types],
      },
    });

    if (!state.session.started) {
      state.session.started = true;
      if (!state.session.id) state.session.id = findSessionId(result.stdoutPath);
      if (resolvedAdapterId === 'codex' && !state.session.id) {
        state.session.continuity = 'synthetic-checkpoint';
      }
    }
    if (result.status !== 'success') break;
    state.scenario.completed_stages.push(stage.id);
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
  writeFileSync(commandLogPath, JSON.stringify(commandLogs, null, 2));
  const result = {
    status: stageResults.length === scenario.stages.length
      && stageResults.every(stage => stage.status === 'success') ? 'success' : 'error',
    duration_ms: Date.now() - runStarted,
    stages: stageResults,
    session: state.session,
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
    run_id: state.run_id,
    case_id: spec.case_id,
    engine: {
      ...spec.engine,
      resolved_adapter: resolvedAdapterId,
      cli_version: detectExecutable(
        spec.engine.executable || adapter.executable,
        adapter.versionArgs,
      ).version,
    },
    usage: withUsageAvailability(aggregateUsage(collectRunUsageEvents(runDir))),
    isolation: spec.isolation,
    human_review_status: 'pending',
    completed_at: new Date().toISOString(),
  };
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(finalResult, null, 2));
  const review = buildHumanReviewPackage({
    run_id: state.run_id,
    reviewer: 'pending-human-review',
    isolation: spec.isolation.mode,
    reviews: [{ case_id: spec.case_id }],
  });
  writeFileSync(join(runDir, 'human-review.json'), `${JSON.stringify(review, null, 2)}\n`);
  state.status = result.status === 'success' ? 'awaiting-evaluation' : 'run-failed';
  state.completed_at = finalResult.completed_at;
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  output(
    result.status,
    result.status === 'success'
      ? 'CLI run completed; machine evidence is ready for human review.'
      : 'CLI run failed; evidence was preserved for diagnosis.',
    ['Review artifacts and complete human-review.json before generating the final report.'],
    [
      join(runDir, 'result.json'),
      join(runDir, 'human-review.json'),
      join(runDir, 'logs', 'stages'),
      join(runDir, 'logs', 'git-status.txt'),
      join(runDir, 'artifacts', 'workspace.diff'),
    ],
    { run_id: state.run_id, run_dir: runDir },
  );
  if (result.status !== 'success') process.exitCode = 1;
}

function withUsageAvailability(usage) {
  const hasTokens = ['input_tokens', 'output_tokens', 'cached_tokens', 'total_tokens']
    .some(key => typeof usage[key] === 'number');
  return {
    ...usage,
    availability: hasTokens || typeof usage.cost_usd === 'number' ? 'reported' : 'unavailable',
  };
}

function collectRunUsageEvents(runDir) {
  const root = join(runDir, 'logs', 'stages');
  const events = [];
  for (const file of listFiles(root)) {
    if (!file.path.endsWith('/normalized-events.jsonl')) continue;
    const lines = readFileSync(join(root, file.path), 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event?.data && typeof event.data === 'object') events.push(event.data);
      } catch {
        // Normalized files are evidence; malformed lines remain in place and contribute no usage.
      }
    }
  }
  return events;
}

function validateCommand(args) {
  const path = resolve(requireOption(args, 'spec'));
  const { value } = loadRunSpec(path);
  const validation = validateRunSpec(value);
  if (!validation.valid) {
    output(
      'error',
      `RunSpec validation failed with ${validation.errors.length} issue(s).`,
      ['Correct the reported paths before preparing a run.'],
      [path],
      {
        errors: validation.errors,
        error: {
          root_cause_hint: validation.errors[0]?.message || 'Invalid RunSpec.',
          safe_retry: 'Fix the RunSpec and rerun validate.',
          stop_condition: 'Do not run the benchmark while validation fails.',
        },
      },
    );
    process.exitCode = 1;
    return;
  }
  output('success', `RunSpec ${value.name} is valid.`, [], [path], {
    case_id: value.case_id,
    engine: value.engine,
  });
}

function proxyJsonScript(script, argv) {
  const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', script), ...argv], {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
  });
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    payload = {
      status: 'error',
      summary: `${script} did not return a JSON envelope.`,
      next_actions: ['Inspect subprocess stderr.'],
      artifacts: [],
      error: {
        root_cause_hint: (result.stderr || result.stdout || '').trim() || 'Unknown subprocess failure.',
        safe_retry: 'Run the child script directly with the same arguments.',
        stop_condition: 'Stop after two identical failures.',
      },
    };
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (result.status !== 0 || payload.status === 'error') process.exitCode = 1;
}

function buildFixtureCommand(args) {
  const caseId = requireOption(args, 'case');
  const runtime = getCaseRuntime(projectRoot, caseId);
  const runDir = resolve(requireOption(args, 'run_dir'));
  proxyJsonScript('build-fixture.mjs', [
    '--case', caseId,
    '--source-root', runtime.starter,
    '--export-root', join(runDir, 'workspace'),
    '--plan', runtime.plan,
  ]);
}

async function evaluateCommand(args) {
  const runDir = resolve(requireOption(args, 'run_dir'));
  const spec = JSON.parse(readFileSync(join(runDir, 'run-spec.json'), 'utf8'));
  const state = JSON.parse(readFileSync(join(runDir, 'run-state.json'), 'utf8'));
  const runtime = getCaseRuntime(projectRoot, spec.case_id);
  const attestationPath = args.attestation || 'observation-attestation.json';
  const evaluation = await runtime.evaluator({
    runId: state.run_id,
    runRoot: runDir,
    attestationPath,
    workspace: join(runDir, 'workspace'),
    logsDir: join(runDir, 'logs', 'evaluator'),
  });
  const summary = {
    ...evaluation,
    summary: {
      p0_state: evaluation.status === 'success' ? 'passed' : 'failed',
      score: evaluation.scorecard?.total ?? null,
      p0_min_score: 80,
    },
  };
  const target = join(runDir, 'evaluator-summary.json');
  writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`);
  output(evaluation.status, `Evaluator completed with score ${evaluation.scorecard?.total ?? 'unknown'}.`, [], [target], {
    run_id: state.run_id,
    case_id: spec.case_id,
    evidence_trust: evaluation.evidence_trust,
  });
}

function captureCommand(args) {
  const spec = resolve(requireOption(args, 'capture_spec'));
  const outDir = resolve(requireOption(args, 'out_dir'));
  const argv = [spec, '--out-dir', outDir];
  if (args.allow_origin) argv.push('--allow-origin', args.allow_origin);
  if (args.allow_file_root) argv.push('--allow-file-root', args.allow_file_root);
  proxyJsonScript('capture-playwright-evidence.mjs', argv);
}

function reportCommand(args) {
  const runDir = resolve(requireOption(args, 'run_dir'));
  const outDir = args.out_dir ? resolve(args.out_dir) : join(runDir, 'reports');
  const argv = [
    '--run', runDir,
    '--scope', 'single-run',
    '--report-id', args.report_id || `report-${Date.now()}`,
    '--out-dir', outDir,
    '--format', args.format || 'all',
  ];
  if (args.demo === true) argv.push('--demo');
  proxyJsonScript('generate-report.mjs', argv);
}

async function goldenCommand(args) {
  const specPath = resolve(requireOption(args, 'spec'));
  const { value: spec } = loadRunSpec(specPath);
  const result = await runGoldenPipeline({
    projectRoot,
    spec,
    outRoot: resolve(args.out_root || join(projectRoot, '.local', 'runs')),
    runId: args.run_id || null,
    failAfter: args.fail_after || null,
    resume: args.resume === true,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'error') process.exitCode = 1;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'doctor') return doctor();
  if (command === 'validate') return validateCommand(args);
  if (command === 'build-fixture') return buildFixtureCommand(args);
  if (command === 'prepare') return prepare(args);
  if (command === 'run') return run(args);
  if (command === 'evaluate') return evaluateCommand(args);
  if (command === 'capture') return captureCommand(args);
  if (command === 'report') return reportCommand(args);
  if (command === 'golden') return goldenCommand(args);
  output(
    'error',
    'Unknown or missing command.',
    [
      'node scripts/bench.mjs doctor',
      'node scripts/bench.mjs validate --spec <run-spec.yaml>',
      'node scripts/bench.mjs build-fixture --case <id> --run-dir <path>',
      'node scripts/bench.mjs prepare --case <id> --engine <codex|kimi|claude> --model <id> [--workspace-source <path>]',
      'node scripts/bench.mjs run --run-dir <path>',
      'node scripts/bench.mjs evaluate --run-dir <path> [--attestation observation-attestation.json]',
      'node scripts/bench.mjs capture --capture-spec <path> --out-dir <path> --allow-origin <origin>',
      'node scripts/bench.mjs report --run-dir <path>',
      'node scripts/bench.mjs golden --spec <path> --out-root <path> [--run-id <id>] [--resume]',
    ],
  );
  process.exitCode = 1;
}

main().catch(error => {
  output('error', error.message, ['Fix the reported issue and retry; stop after two identical failures.']);
  process.exitCode = 1;
});
