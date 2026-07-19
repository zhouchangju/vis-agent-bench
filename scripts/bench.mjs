#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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

const COMMON_CHILD_ENV = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'NO_COLOR', 'CI',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
]);

const ADAPTER_CHILD_ENV = Object.freeze({
  codex: ['CODEX_HOME', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID'],
  kimi: ['KIMI_API_KEY', 'KIMI_CODE_HOME', 'MOONSHOT_API_KEY'],
  claude: [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ],
});

function childEnvironment(adapter, extra = {}) {
  const keys = [...COMMON_CHILD_ENV, ...(ADAPTER_CHILD_ENV[adapter] || [])];
  const env = {};
  for (const key of keys) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

function validationEnvironment(runDir, extra = {}) {
  const isolatedHome = join(runDir, '.validation-home');
  const npmCache = join(runDir, '.validation-npm-cache');
  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  const env = {};
  for (const key of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'NO_COLOR', 'CI']) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: isolatedHome,
    npm_config_cache: npmCache,
    ...extra,
  };
}

function jsonDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertRuntimePolicy(spec, adapter) {
  const known = new Set(['shell', 'file_read', 'file_write', 'public_web']);
  const allowed = new Set(spec.permissions.allowed_tools);
  const unknown = [...allowed].filter(tool => !known.has(tool));
  if (unknown.length) throw new Error(`Unsupported allowed_tools: ${unknown.join(', ')}`);
  for (const required of ['shell', 'file_read', 'file_write']) {
    if (!allowed.has(required)) {
      throw new Error(`${adapter} cannot enforce a RunSpec that removes required tool "${required}".`);
    }
  }
  const network = spec.isolation.network === true || spec.isolation.network === 'enabled';
  if (spec.isolation.block_internal_network === true) {
    throw new Error(
      'block_internal_network=true is unsupported by file-isolated-development; use container/network isolation.',
    );
  }
  if (!network && adapter !== 'codex') {
    throw new Error(`${adapter} has no verified network-deny control; use Codex or enable network.`);
  }
  if (!network && allowed.has('public_web')) {
    throw new Error('public_web cannot be allowed while network is disabled.');
  }
  if (network && !allowed.has('public_web')) {
    throw new Error(`${adapter} cannot enforce network enabled while public_web is removed.`);
  }
  return { network, allowed_tools: [...allowed] };
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
    `把符号型 checkpoint 写入 .vab/checkpoints/${stage.id}.json：`,
    '{"schema_version":1,"stage_id":"当前阶段","artifacts":{"checkpoint-name":["相对 workspace 的证据文件"]}}',
    'checkpoint 中带路径/扩展名的项目必须直接创建该文件；所有 manifest 引用必须存在且位于 workspace 内。',
    '最后阶段会由 Harness 自动运行 package.json 中存在的 build、typecheck、test 脚本；只报告真实结果。',
    '结束时简要输出：status、summary、next_actions、artifacts。',
    '',
  ].join('\n');
}

function verifyStageDeliverables(workspace, stage, logsDir, timeoutMs, env) {
  const required = Array.isArray(stage.checkpoint) ? stage.checkpoint : [];
  const missing = [];
  const artifacts = [];
  const ledger = containedWorkspacePath(workspace, 'requirement-ledger.yaml');
  if (!existsSync(ledger)) missing.push('requirement-ledger.yaml');
  else {
    const parsed = parseYaml(readFileSync(ledger, 'utf8'));
    if (!parsed || typeof parsed !== 'object') missing.push('requirement-ledger.yaml (invalid YAML object)');
    else artifacts.push(ledger);
  }

  const symbolic = [];
  for (const item of required) {
    const target = item === 'final-requirement-ledger'
      ? ledger
      : (/[/.]/.test(item) ? containedWorkspacePath(workspace, item) : null);
    if (target) {
      if (!existsSync(target)) missing.push(item);
      else artifacts.push(target);
    } else {
      symbolic.push(item);
    }
  }

  if (symbolic.length) {
    const manifestPath = join(workspace, '.vab', 'checkpoints', `${stage.id}.json`);
    if (!existsSync(manifestPath)) {
      missing.push(`.vab/checkpoints/${stage.id}.json`);
    } else {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.schema_version !== 1 || manifest.stage_id !== stage.id) {
        missing.push(`.vab/checkpoints/${stage.id}.json (invalid identity)`);
      }
      for (const item of symbolic) {
        const refs = manifest.artifacts?.[item];
        if (!Array.isArray(refs) || refs.length === 0) {
          missing.push(`${item} (manifest evidence missing)`);
          continue;
        }
        for (const ref of refs) {
          const target = containedWorkspacePath(workspace, ref);
          if (!existsSync(target)) missing.push(`${item} -> ${ref}`);
          else artifacts.push(target);
        }
      }
      artifacts.push(manifestPath);
    }
  }

  const commandResults = [];
  if (isFinalStage(stage)) {
    const packagePath = join(workspace, 'package.json');
    if (!existsSync(packagePath)) {
      missing.push('package.json');
    } else {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      const commands = ['build', 'typecheck', 'test'].filter(name => pkg.scripts?.[name]);
      const perCommandTimeout = Math.max(1_000, Math.floor(timeoutMs / Math.max(commands.length, 1)));
      for (const name of commands) {
        const command = spawnSync('npm', ['run', name], {
          cwd: workspace,
          encoding: 'utf8',
          shell: false,
          timeout: perCommandTimeout,
          maxBuffer: 10 * 1024 * 1024,
          env,
        });
        const evidence = {
          name,
          exit_code: command.status,
          signal: command.signal,
          error: command.error?.message || null,
          stdout: command.stdout || '',
          stderr: command.stderr || '',
        };
        commandResults.push(evidence);
        if (command.status !== 0 || command.error) missing.push(`npm run ${name}`);
      }
    }
  }

  const gate = {
    status: missing.length ? 'error' : 'success',
    stage_id: stage.id,
    required,
    artifacts: [...new Set(artifacts)],
    missing,
    commands: commandResults,
  };
  const gatePath = join(logsDir, 'checkpoint-gate.json');
  writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`);
  if (missing.length) {
    const error = new Error(`Stage ${stage.id} checkpoint gate failed: ${missing.join(', ')}`);
    error.gatePath = gatePath;
    throw error;
  }
  return { ...gate, gate_path: gatePath };
}

function containedWorkspacePath(workspace, ref) {
  if (typeof ref !== 'string' || ref.length === 0) throw new TypeError('Checkpoint artifact path must be non-empty.');
  const root = resolve(workspace);
  const target = resolve(root, ref);
  const rel = target.slice(root.length + 1);
  if (target === root || !target.startsWith(`${root}/`) || rel.startsWith('..')) {
    throw new TypeError(`Checkpoint artifact escapes workspace: ${ref}`);
  }
  if (existsSync(target)) {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(target);
    if (realTarget === realRoot || !realTarget.startsWith(`${realRoot}/`)) {
      throw new TypeError(`Checkpoint artifact symlink escapes workspace: ${ref}`);
    }
  }
  return target;
}

function isFinalStage(stage) {
  return (stage.checkpoint || []).some(item => [
    'candidate-delivery',
    'final-requirement-ledger',
  ].includes(item));
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

function prepare(args, emit = true) {
  const supplied = args._spec_value || (args.spec ? loadRunSpec(args.spec).value : null);
  const caseId = supplied?.case_id || requireOption(args, 'case');
  const engine = adapterId(supplied?.engine?.adapter || requireOption(args, 'engine'));
  const model = supplied?.engine?.configured_model || requireOption(args, 'model');
  getAdapter(engine);

  const caseDir = join(projectRoot, 'cases', caseId);
  if (!existsSync(caseDir)) throw new Error(`Unknown case: ${caseId}`);
  const scenario = loadScenario(caseDir);

  const runId = args.run_id || `${new Date().toISOString().replaceAll(/[:.]/g, '-')}_${engine}_${randomUUID().slice(0, 8)}`;
  const runDir = createRunLayout(projectRoot, runId);
  mkdirSync(join(runDir, '.empty-skills'), { recursive: true });
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
    const message = `Answer leakage scan found ${leakage.length} issue(s); run was not prepared.`;
    if (!emit) throw new Error(message);
    output('error', message, ['Use a sanitized scaffold without existing implementation or Git history.'], [
      join(runDir, 'logs', 'leakage-scan.json'),
    ], { run_id: runId, run_dir: runDir });
    process.exitCode = 2;
    return null;
  }

  const spec = supplied ? {
    ...structuredClone(supplied),
    isolation: {
      ...supplied.isolation,
      workspace_root: join(runDir, 'workspace'),
    },
  } : buildRunSpec({
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
  const validation = validateRunSpec(spec);
  if (!validation.valid) throw new Error(`RunSpec is invalid: ${JSON.stringify(validation.errors)}`);
  assertRuntimePolicy(spec, engine);
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
    run_spec_sha256: jsonDigest(spec),
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

  const payload = {
    status: 'success',
    summary: `Prepared file-isolated development run ${runId}.`,
    next_actions: [`Run: node scripts/bench.mjs run --run-dir "${runDir}"`],
    artifacts: [
      join(runDir, 'run-spec.json'),
      join(runDir, 'run-state.json'),
      join(runDir, 'input', `stage-${firstStage.id}.md`),
      join(runDir, 'logs', 'leakage-scan.json'),
    ],
    run_id: runId,
    run_dir: runDir,
  };
  if (emit) output(payload.status, payload.summary, payload.next_actions, payload.artifacts, {
    run_id: runId,
    run_dir: runDir,
  });
  return payload;
}

function prepareBundleCommand(args) {
  const path = resolve(requireOption(args, 'bundle'));
  const bundle = JSON.parse(readFileSync(path, 'utf8'));
  if (bundle.kind !== 'vis-agent-bench-run-spec-bundle' || !Array.isArray(bundle.runs) || !bundle.runs.length) {
    throw new Error('Bundle must be a vis-agent-bench-run-spec-bundle with at least one run.');
  }
  if (args.run_id && bundle.runs.length > 1) {
    throw new Error('--run-id cannot be shared by multiple bundle entries.');
  }
  const runs = bundle.runs.map((spec, index) => prepare({
    ...args,
    _spec_value: spec,
    run_id: args.run_id || `bundle-${Date.now()}-${index + 1}-${randomUUID().slice(0, 6)}`,
  }, false));
  output(
    'success',
    `Prepared ${runs.length} run(s) from the setup-page bundle.`,
    runs.map(run => run.next_actions[0]),
    runs.flatMap(run => run.artifacts),
    { runs: runs.map(({ run_id, run_dir }) => ({ run_id, run_dir })) },
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
  if (state.run_spec_sha256 !== jsonDigest(spec)) {
    throw new Error('RunSpec digest differs from the prepared run state; create a new run-id.');
  }
  if (state.status === 'running' && processIsAlive(state.process_pid)) {
    throw new Error(`Run is already active in process ${state.process_pid}.`);
  }
  if (!['prepared', 'run-failed', 'running'].includes(state.status)) {
    throw new Error(`Run status must be prepared, run-failed, or recoverable running; got ${state.status}`);
  }

  const leakage = scanForAnswerLeakage(spec.case_id, join(runDir, 'workspace'));
  if (leakage.length) throw new Error(`Preflight failed: ${leakage.length} answer leakage finding(s)`);

  const resolvedAdapterId = adapterId(spec.engine.adapter);
  const adapter = getAdapter(resolvedAdapterId);
  assertRuntimePolicy(spec, resolvedAdapterId);
  state.status = 'running';
  state.started_at = state.started_at || new Date().toISOString();
  state.process_pid = process.pid;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const caseDir = join(projectRoot, 'cases', spec.case_id);
  const scenario = loadScenario(caseDir);
  const stageResults = [];
  const commandLogPath = join(runDir, 'logs', 'commands.json');
  const commandLogs = existsSync(commandLogPath)
    ? JSON.parse(readFileSync(commandLogPath, 'utf8'))
    : [];
  const runStarted = Date.now();
  const runDeadline = Date.parse(state.started_at) + spec.budget.wall_time_minutes * 60_000;
  const completed = new Set(state.scenario.completed_stages);

  for (const stage of scenario.stages) {
    if (completed.has(stage.id)) {
      stageResults.push({ stage_id: stage.id, status: 'success', resumed_from_checkpoint: true });
      continue;
    }
    const remaining = runDeadline - Date.now();
    if (remaining <= 0) {
      stageResults.push({ stage_id: stage.id, status: 'error', error: 'run budget exhausted' });
      break;
    }
    const previousAttempts = state.scenario.attempts?.[stage.id] || 0;
    if (previousAttempts >= 1 + spec.budget.max_retries) {
      stageResults.push({
        stage_id: stage.id,
        status: 'error',
        error: `retry budget exhausted (${spec.budget.max_retries} retries allowed)`,
      });
      break;
    }
    const beforeUsage = withUsageAvailability(aggregateUsage(collectRunUsageEvents(runDir)));
    const beforeViolation = beforeUsage.source_events.length
      ? budgetViolation(spec, beforeUsage)
      : null;
    if (beforeViolation) {
      stageResults.push({ stage_id: stage.id, status: 'error', error: beforeViolation });
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
      env: childEnvironment(resolvedAdapterId, {
        VIS_AGENT_BENCH_RUN_ID: state.run_id,
        VIS_AGENT_BENCH_STAGE_ID: stage.id,
        VIS_AGENT_BENCH_ISOLATION: 'file-isolated-development',
      }),
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
    let effectiveResult = result;
    let checkpointGate = null;
    if (result.status === 'success') {
      try {
        checkpointGate = verifyStageDeliverables(
          join(runDir, 'workspace'),
          stage,
          stageLogs,
          Math.max(1_000, remaining - result.duration_ms),
          validationEnvironment(runDir, {
            VIS_AGENT_BENCH_RUN_ID: state.run_id,
            VIS_AGENT_BENCH_STAGE_ID: stage.id,
            VIS_AGENT_BENCH_ISOLATION: 'file-isolated-development',
          }),
        );
      } catch (error) {
        effectiveResult = {
          ...result,
          status: 'error',
          error: error.message,
          failure_source: 'checkpoint-gate',
          checkpoint_gate_path: error.gatePath || null,
        };
      }
    }
    const afterUsage = withUsageAvailability(aggregateUsage(collectRunUsageEvents(runDir)));
    const afterViolation = budgetViolation(spec, afterUsage);
    if (afterViolation && effectiveResult.status === 'success') {
      effectiveResult = {
        ...effectiveResult,
        status: 'error',
        error: afterViolation,
        failure_source: 'budget',
      };
    }
    stageResults.push({
      stage_id: stage.id,
      attempt,
      ...effectiveResult,
      normalized: normalizedPath,
      checkpoint_gate: checkpointGate,
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
    if (effectiveResult.status !== 'success') break;
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
  state.process_pid = null;
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function budgetViolation(spec, usage) {
  if (typeof spec.budget.max_tokens === 'number') {
    if (typeof usage.total_tokens !== 'number') {
      return 'token budget cannot be enforced because the CLI did not report token usage';
    }
    if (usage.total_tokens > spec.budget.max_tokens) {
      return `token budget exceeded: ${usage.total_tokens} > ${spec.budget.max_tokens}`;
    }
  }
  if (typeof spec.budget.max_cost_usd === 'number') {
    if (typeof usage.cost_usd !== 'number') {
      return 'cost budget cannot be enforced because the CLI did not report cost';
    }
    if (usage.cost_usd > spec.budget.max_cost_usd) {
      return `cost budget exceeded: ${usage.cost_usd} > ${spec.budget.max_cost_usd}`;
    }
  }
  return null;
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
  const runResult = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'));
  const evaluatorPath = join(runDir, 'evaluator-summary.json');
  const evaluator = existsSync(evaluatorPath)
    ? JSON.parse(readFileSync(evaluatorPath, 'utf8'))
    : null;
  const forceDemo = runResult.demo === true
    || evaluator?.demo_only === true
    || evaluator?.conclusion_eligible === false
    || evaluator?.evidence_trust?.conclusion_eligible === false;
  const argv = [
    '--run', runDir,
    '--scope', 'single-run',
    '--report-id', args.report_id || `report-${Date.now()}`,
    '--out-dir', outDir,
    '--format', args.format || 'all',
  ];
  if (args.demo === true || forceDemo) argv.push('--demo');
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
  if (command === 'prepare-bundle') return prepareBundleCommand(args);
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
      'node scripts/bench.mjs prepare --spec <run-spec.json>',
      'node scripts/bench.mjs prepare --case <id> --engine <codex|kimi|claude> --model <id> [--workspace-source <path>]',
      'node scripts/bench.mjs prepare-bundle --bundle <setup-export.json>',
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
