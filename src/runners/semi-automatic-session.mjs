import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  watch as fsWatch,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { semiAutomaticAdapter } from './semi-automatic-adapter.mjs';
import { getAdapter } from './adapters.mjs';
import { validateRunSpec } from '../contracts/index.mjs';
import { getCaseRuntime } from '../control-plane/case-registry.mjs';
import { buildRunSpec, adapterId } from '../control-plane/run-spec.mjs';
import {
  copyWorkspaceSource,
  createRunLayout,
  listFiles,
  scanForAnswerLeakage,
} from '../core/file-isolation.mjs';
import {
  collectRunObservation,
  writeAttestation,
} from '../control-plane/run-observation-collector.mjs';
import { buildHumanReviewPackage } from '../review/human-review-package.mjs';
import { aggregateUsage, normalizeStdout } from '../telemetry/index.mjs';
import { containedRunDirectory } from '../core/run-id.mjs';

// ---------------------------------------------------------------------------
// Prompt + delivery protocol helpers (replicated from bench.mjs for reuse)
// ---------------------------------------------------------------------------

function jsonDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readCaseTaskType(caseDir) {
  const configPath = join(caseDir, 'case.yaml');
  if (!existsSync(configPath)) return null;
  try {
    const config = parseYaml(readFileSync(configPath, 'utf8'));
    return typeof config?.task_type === 'string' ? config.task_type : null;
  } catch {
    return null;
  }
}

const DELIVERY_PROTOCOLS = {
  'development-smoke': stage => [
    '这是开发管道 Smoke：禁止启动子 Agent、后台任务和联网。',
    '不要扩展需求或过度设计；直接完成 checkpoint，使用尽可能少的工具调用。',
    '本阶段最多进行一次必要的本地验证，不要反复自检。',
    '不得修改 package.json 中既有的 build、typecheck、test script，也不得修改父 Run 中任何已存在的 scripts/*.mjs；它们都是 Harness 的基线完整性门禁。',
    `更新 workspace 根目录的 requirement-ledger.yaml：必须使用 JSON 语法（JSON 也是合法 YAML），且只能有一个文档。严格采用对象数组字段 \`confirmed\`、\`decisions\`、\`assumptions\`、\`open_questions\`；每项写成 \`{"priority":"must|should|may","text":"..."}\`，文本中的中文引号和冒号必须位于 JSON 字符串内。不要写 \`---\`、\`...\`、Markdown 标题或 \`- dec:\` 这类 YAML 简写。`,
    `本阶段 checkpoint：${(stage.checkpoint || []).join('、')}`,
    `把符号型 checkpoint 写入 .vab/checkpoints/${stage.id}.json：`,
    `{"schema_version":1,"stage_id":"${stage.id}","artifacts":{"checkpoint-name":["相对 workspace 的证据文件"]}}`,
    'checkpoint 中带路径/扩展名的项目必须直接创建该文件；所有 manifest 引用必须存在且位于 workspace 内。',
    '最后阶段会由 Harness 自动运行 package.json 中存在的 build、typecheck、test 脚本；只报告真实结果。',
    '结束时简要输出：status、summary、next_actions、artifacts。',
  ],
  'visual-debugging': stage => [
    '这是诊断答疑任务：产出是结构化 Markdown 诊断与可执行修复，不需要构建或测试代码。',
    '不得修改或删除 Harness 提供的截图、源码样本和参考材料。',
    `更新 workspace 根目录的 requirement-ledger.yaml：必须使用 JSON 语法（JSON 也是合法 YAML），且只能有一个文档。严格采用对象数组字段 \`confirmed\`、\`decisions\`、\`assumptions\`、\`open_questions\`；每项写成 \`{"priority":"must|should|may","text":"..."}\`，文本中的中文引号和冒号必须位于 JSON 字符串内。不要写 \`---\`、\`...\`、Markdown 标题或 \`- dec:\` 这类 YAML 简写。`,
    `本阶段 checkpoint：${(stage.checkpoint || []).join('、')}`,
    `把符号型 checkpoint 写入 .vab/checkpoints/${stage.id}.json：`,
    `{"schema_version":1,"stage_id":"${stage.id}","artifacts":{"checkpoint-name":["相对 workspace 的证据文件"]}}`,
    'checkpoint 中带路径/扩展名的项目必须直接创建该文件（Markdown、patch、option 均可）；所有 manifest 引用必须存在且位于 workspace 内。',
    '结束时简要输出：status、summary、next_actions、artifacts。',
  ],
  default: stage => [
    '只处理当前已知信息，不要猜测后续需求。',
    '不得修改 package.json 中既有的 build、typecheck、test script，也不得修改父 Run 中任何已存在的 scripts/*.mjs；它们都是 Harness 的基线完整性门禁。可以新增功能代码、文档、数据和以 revision- 开头的独立测试脚本。',
    '更新 workspace 根目录的 requirement-ledger.yaml：必须使用 JSON 语法（JSON 也是合法 YAML），且只能有一个文档。严格采用对象数组字段 `confirmed`、`decisions`、`assumptions`、`open_questions`；每项写成 `{"priority":"must|should|may","text":"..."}`，文本中的中文引号和冒号必须位于 JSON 字符串内。不要写 `---`、`...`、Markdown 标题或 `- dec:` 这类 YAML 简写。',
    `本阶段 checkpoint：${(stage.checkpoint || []).join('、')}`,
    `把符号型 checkpoint 写入 .vab/checkpoints/${stage.id}.json：`,
    `{"schema_version":1,"stage_id":"${stage.id}","artifacts":{"checkpoint-name":["相对 workspace 的证据文件"]}}`,
    'checkpoint 中带路径/扩展名的项目必须直接创建该文件；所有 manifest 引用必须存在且位于 workspace 内。',
    '最后阶段会由 Harness 自动运行 package.json 中存在的 build、typecheck、test 脚本；只报告真实结果。',
    '结束时简要输出：status、summary、next_actions、artifacts。',
  ],
};

export function stagePrompt(caseDir, scenario, stage) {
  const content = stage.input
    ? readFileSync(join(caseDir, 'scenario', stage.input), 'utf8')
    : stage.stakeholder_message;
  const taskType = readCaseTaskType(caseDir);
  const protocolBuilder = DELIVERY_PROTOCOLS[taskType] || DELIVERY_PROTOCOLS.default;
  return [
    content.trim(),
    '',
    '## 本阶段交付协议',
    '',
    `当前阶段：${stage.id} / ${stage.name}`,
    ...protocolBuilder(stage),
    '',
  ].join('\n');
}

export function loadScenario(caseDir) {
  const path = join(caseDir, 'scenario', 'stages.yaml');
  if (!existsSync(path)) throw new Error(`Missing staged scenario: ${path}`);
  const scenario = parseYaml(readFileSync(path, 'utf8'));
  if (!Array.isArray(scenario.stages) || scenario.stages.length === 0) {
    throw new Error(`Scenario has no stages: ${path}`);
  }
  return scenario;
}

export function loadRunScenario(runDir, caseDir) {
  const revisionScenario = join(runDir, 'scenario', 'stages.yaml');
  if (existsSync(revisionScenario)) return parseYaml(readFileSync(revisionScenario, 'utf8'));
  return loadScenario(caseDir);
}

export function isFinalStage(stage) {
  return (stage.checkpoint || []).some(item => [
    'candidate-delivery',
    'final-requirement-ledger',
  ].includes(item));
}

function containedWorkspacePath(workspace, ref) {
  if (typeof ref !== 'string' || ref.length === 0) throw new TypeError('Checkpoint artifact path must be non-empty.');
  const root = resolve(workspace);
  const target = resolve(root, ref);
  const rel = target.slice(root.length + 1);
  if (target === root || !target.startsWith(`${root}/`) || rel.startsWith('..')) {
    throw new TypeError(`Checkpoint artifact escapes workspace: ${ref}`);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Checkpoint verification (simplified, no build/test gate)
// ---------------------------------------------------------------------------

export function verifyCheckpointGate(workspace, stage) {
  const required = Array.isArray(stage.checkpoint) ? stage.checkpoint : [];
  const missing = [];
  const artifacts = [];
  const ledger = containedWorkspacePath(workspace, 'requirement-ledger.yaml');
  if (!existsSync(ledger)) missing.push('requirement-ledger.yaml');
  else {
    try {
      const parsed = parseYaml(readFileSync(ledger, 'utf8'));
      if (!parsed || typeof parsed !== 'object') missing.push('requirement-ledger.yaml (invalid YAML object)');
      else artifacts.push(ledger);
    } catch {
      missing.push('requirement-ledger.yaml (parse error)');
    }
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
      try {
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
      } catch {
        missing.push(`.vab/checkpoints/${stage.id}.json (parse error)`);
      }
    }
  }

  return {
    status: missing.length ? 'error' : 'success',
    stage_id: stage.id,
    required,
    artifacts: [...new Set(artifacts)],
    missing,
  };
}

export function baselinePackageGate(workspace) {
  const packagePath = join(workspace, 'package.json');
  if (!existsSync(packagePath)) return { scripts: {}, protected_files: [] };
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  return {
    scripts: Object.fromEntries(
      ['build', 'typecheck', 'test']
        .filter(name => typeof pkg.scripts?.[name] === 'string')
        .map(name => [name, pkg.scripts[name]]),
    ),
    protected_files: [],
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Prepare a new semi-automatic run.
 *
 * @param {{ projectRoot: string, runRoot: string, runSpec: object, scenario: object,
 *            caseRuntime: object, runId: string }} params
 */
export async function runSemiAutomaticSession({
  projectRoot, runRoot, runSpec, scenario, caseRuntime, runId,
}) {
  const runDir = resolve(runRoot);
  const caseDir = join(projectRoot, 'cases', runSpec.case_id);

  // Generate the run directory layout.
  if (!existsSync(runDir)) {
    createRunLayout(projectRoot, runId);
    // The real runDir from createRunLayout
    const realRunDir = containedRunDirectory(resolve(projectRoot, '.local', 'runs'), runId);
    // If the caller gave us a different path, use it; otherwise use the one just created.
    if (!existsSync(realRunDir)) {
      mkdirSync(realRunDir, { recursive: true });
    }
  }

  mkdirSync(join(runDir, '.empty-skills'), { recursive: true });

  // Copy workspace source or build fixture.
  if (!existsSync(join(runDir, 'workspace', '.fixture', 'manifest.json'))) {
    copyWorkspaceSource(caseRuntime.starter, join(runDir, 'workspace'));
  }

  // Leakage scan.
  const leakage = scanForAnswerLeakage(runSpec.case_id, join(runDir, 'workspace'));
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  writeFileSync(join(runDir, 'logs', 'leakage-scan.json'), JSON.stringify(leakage, null, 2));
  if (leakage.length) {
    return {
      status: 'error',
      summary: `Answer leakage scan found ${leakage.length} issue(s); run was not prepared.`,
      next_actions: ['Use a sanitized scaffold without existing implementation or Git history.'],
      artifacts: [join(runDir, 'logs', 'leakage-scan.json')],
      run_id: runId,
      run_dir: runDir,
    };
  }

  // Validate or create run spec.
  const spec = runSpec || buildRunSpec({
    name: `${runSpec?.case_id || 'unknown'}-semi-auto`,
    case_id: runSpec?.case_id,
    engine: {
      adapter: 'semi-auto',
      executable: null,
      configured_model: runSpec?.engine?.configured_model || 'manual',
      provider: runSpec?.engine?.provider || 'manual-operator',
      credential_ref: 'none',
    },
    workspace_root: join(runDir, 'workspace'),
  });
  const validation = validateRunSpec(spec);
  if (!validation.valid) throw new Error(`RunSpec is invalid: ${JSON.stringify(validation.errors)}`);

  // Initialize git in workspace.
  spawnSync('git', ['init', '-q'], { cwd: join(runDir, 'workspace'), shell: false });
  spawnSync('git', ['add', '.'], { cwd: join(runDir, 'workspace'), shell: false });
  const commit = spawnSync('git', [
    '-c', 'user.name=vis-agent-bench',
    '-c', 'user.email=bench@local',
    'commit', '-qm', 'benchmark baseline',
  ], { cwd: join(runDir, 'workspace'), encoding: 'utf8', shell: false });
  if (commit.status !== 0) throw new Error(`Unable to create benchmark baseline commit: ${commit.stderr || commit.stdout}`);
  const baseline = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: join(runDir, 'workspace'), encoding: 'utf8', shell: false,
  });
  if (baseline.status !== 0 || !/^[0-9a-f]{40}$/.test(baseline.stdout.trim())) {
    throw new Error('Unable to record immutable benchmark baseline commit.');
  }

  const state = {
    schema_version: 1,
    run_id: runId,
    status: 'semi-auto-waiting',
    scenario: {
      mode: scenario.mode,
      stage_ids: scenario.stages.map(s => s.id),
      current_stage: null,
      completed_stages: [],
      attempts: {},
      future_stage_inputs_copied: false,
    },
    session: {
      id: null,
      continuity: 'manual-checkpoint',
      started: true,
      semi_auto: true,
    },
    run_spec_sha256: jsonDigest(spec),
    package_gate: baselinePackageGate(join(runDir, 'workspace')),
    baseline_commit: baseline.stdout.trim(),
    started_at: new Date().toISOString(),
    process_pid: null,
  };

  writeFileSync(join(runDir, 'run-spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(runDir, 'run-state.json'), JSON.stringify(state, null, 2));
  writeFileSync(
    join(runDir, 'logs', 'files-before.json'),
    JSON.stringify(listFiles(join(runDir, 'workspace')), null, 2),
  );

  // Use the adapter's prepare to write README and first stage prompt.
  const inputDir = join(runDir, 'input');
  const workspaceDir = join(runDir, 'workspace');
  const logsDir = join(runDir, 'logs');

  const stagePromptResolver = (stageId) => {
    const stage = scenario.stages.find(s => s.id === stageId);
    if (!stage) throw new Error(`Unknown stage: ${stageId}`);
    return stagePrompt(caseDir, scenario, stage);
  };

  mkdirSync(inputDir, { recursive: true });
  const prepResult = await semiAutomaticAdapter.prepare({
    paths: { inputDir, workspaceDir, logsDir, runDir },
    scenario,
    stagePrompt: stagePromptResolver,
  });

  const firstStageId = prepResult.stageId;
  state.scenario.current_stage = firstStageId;
  writeFileSync(join(runDir, 'run-state.json'), JSON.stringify(state, null, 2));

  return {
    run_id: runId,
    run_dir: runDir,
    nextStage: firstStageId,
    status: 'awaiting_user',
    instructions: [
      `1. Open your AI coding agent in the workspace: ${workspaceDir}`,
      `2. Feed it the prompt from: ${join(inputDir, `stage-${firstStageId}.md`)}`,
      `3. When stage ${firstStageId} completes, write checkpoint to .vab/checkpoints/${firstStageId}.json`,
      `4. Run: node scripts/bench.mjs resume-semi-auto "${runDir}"`,
      `Or use watch mode: node scripts/bench.mjs watch-semi-auto "${runDir}"`,
    ],
  };
}

/**
 * Resume / advance a semi-automatic session.
 *
 * @param {{ runRoot: string, runSpec?: object, projectRoot: string }} params
 */
export async function resumeSemiAutomaticSession({
  runRoot, runSpec, projectRoot,
}) {
  const runDir = resolve(runRoot);
  const specPath = join(runDir, 'run-spec.json');
  const statePath = join(runDir, 'run-state.json');

  if (!existsSync(specPath) || !existsSync(statePath)) {
    throw new Error(`Run directory is not prepared: ${runDir}`);
  }

  let spec = runSpec || JSON.parse(readFileSync(specPath, 'utf8'));
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  if (state.status !== 'semi-auto-waiting' && state.status !== 'semi-auto-running') {
    throw new Error(`Run is not in a semi-auto state; got ${state.status}`);
  }

  const caseDir = join(projectRoot, 'cases', spec.case_id);
  const scenario = loadRunScenario(runDir, caseDir);

  const workspaceDir = join(runDir, 'workspace');
  const inputDir = join(runDir, 'input');
  const logsDir = join(runDir, 'logs');

  const currentStageId = state.scenario.current_stage;
  const completedStages = new Set(state.scenario.completed_stages || []);

  // Check if current stage's checkpoint exists.
  const checkResult = await semiAutomaticAdapter.checkStageCompletion(
    { paths: { workspaceDir, inputDir, logsDir, runDir } },
    currentStageId,
  );

  if (!checkResult.completed) {
    return {
      run_id: state.run_id,
      run_dir: runDir,
      status: 'awaiting_user',
      waitingOnStage: currentStageId,
      completedStages: [...completedStages],
      message: `Stage ${currentStageId} has not been completed yet. Write checkpoint to .vab/checkpoints/${currentStageId}.json`,
    };
  }

  // Verify checkpoint deliverables.
  const stage = scenario.stages.find(s => s.id === currentStageId);
  if (!stage) throw new Error(`Unknown stage: ${currentStageId}`);

  const gate = verifyCheckpointGate(workspaceDir, stage);
  const gatePath = join(logsDir, 'stages', currentStageId, 'checkpoint-gate.json');
  mkdirSync(join(logsDir, 'stages', currentStageId), { recursive: true });
  writeFileSync(gatePath, JSON.stringify(gate, null, 2));

  const gateLabel = currentStageId === 'S0' ? 'stage-0' : currentStageId;

  const commandLogPath = join(logsDir, 'commands.json');
  const commandLogs = existsSync(commandLogPath)
    ? JSON.parse(readFileSync(commandLogPath, 'utf8'))
    : [];
  commandLogs.push({
    stage_id: currentStageId,
    attempt: (state.scenario.attempts?.[currentStageId] || 0) + 1,
    executable: 'semi-auto (manual)',
    args: [`See ${join(inputDir, `stage-${currentStageId}.md`)}`],
    cwd: workspaceDir,
    isolation: spec.isolation,
  });
  mkdirSync(join(logsDir, 'stages', currentStageId), { recursive: true });
  writeFileSync(commandLogPath, JSON.stringify(commandLogs, null, 2));

  if (gate.status === 'error') {
    state.status = 'run-failed';
    state.process_pid = null;
    state.scenario.current_stage = currentStageId;
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    return {
      run_id: state.run_id,
      run_dir: runDir,
      status: 'error',
      waitingOnStage: currentStageId,
      completedStages: [...completedStages],
      message: `Stage ${currentStageId} checkpoint gate failed: ${gate.missing.join(', ')}`,
      gate,
    };
  }

  // Mark current stage as completed.
  state.scenario.completed_stages = [...completedStages, currentStageId];
  state.scenario.attempts = state.scenario.attempts || {};
  state.scenario.attempts[currentStageId] = (state.scenario.attempts[currentStageId] || 0) + 1;

  // Check if this was the last stage.
  const stageIndex = scenario.stages.findIndex(s => s.id === currentStageId);
  const nextStage = scenario.stages[stageIndex + 1];

  if (!nextStage) {
    // All stages complete — collect final artifacts and run evaluation.
    return await collectSemiAutoRun({
      runDir, spec, state, projectRoot, scenario, caseDir,
    });
  }

  // Advance to next stage.
  const stagePromptResolver = (sid) => {
    const s = scenario.stages.find(ss => ss.id === sid);
    if (!s) throw new Error(`Unknown stage: ${sid}`);
    return stagePrompt(caseDir, scenario, s);
  };

  await semiAutomaticAdapter.advanceStage(
    { paths: { inputDir, workspaceDir, logsDir, runDir }, scenario, stagePrompt: stagePromptResolver },
    nextStage.id,
  );

  state.scenario.current_stage = nextStage.id;
  state.status = 'semi-auto-waiting';
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  return {
    run_id: state.run_id,
    run_dir: runDir,
    status: 'awaiting_user',
    waitingOnStage: nextStage.id,
    completedStages: [...state.scenario.completed_stages],
    message: `Advanced to stage ${nextStage.id}. Prompt written to ${join(inputDir, `stage-${nextStage.id}.md`)}`,
    nextStage: nextStage.id,
    gate,
  };
}

/**
 * Collect final artifacts and optionally run evaluation (same as bench.mjs run() tail).
 */
async function collectSemiAutoRun({
  runDir, spec, state, projectRoot, scenario, caseDir,
}) {
  const statePath = join(runDir, 'run-state.json');
  const workspaceDir = join(runDir, 'workspace');
  const runStarted = Date.now();

  // Write files-after.
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  const filesAfter = listFiles(workspaceDir);
  writeFileSync(join(runDir, 'logs', 'files-after.json'), JSON.stringify(filesAfter, null, 2));

  // Git status + diff.
  const status = spawnSync('git', ['status', '--short'], {
    cwd: workspaceDir, encoding: 'utf8', shell: false,
  });
  writeFileSync(join(runDir, 'logs', 'git-status.txt'), status.stdout || '');
  spawnSync('git', ['add', '-N', '.'], { cwd: workspaceDir, shell: false });
  const diff = spawnSync('git', ['diff', '--binary', '--no-ext-diff'], {
    cwd: workspaceDir, encoding: 'utf8', shell: false,
  });
  mkdirSync(join(runDir, 'artifacts'), { recursive: true });
  writeFileSync(join(runDir, 'artifacts', 'workspace.diff'), diff.stdout || '');

  // Build result.json.
  const stageResults = scenario.stages.map(stage => {
    const completed = state.scenario.completed_stages.includes(stage.id);
    const gatePath = join(runDir, 'logs', 'stages', stage.id, 'checkpoint-gate.json');
    let gate = null;
    if (existsSync(gatePath)) {
      try { gate = JSON.parse(readFileSync(gatePath, 'utf8')); } catch { /* ignore */ }
    }
    return {
      stage_id: stage.id,
      status: completed ? 'success' : 'error',
      attempt: state.scenario.attempts?.[stage.id] || 0,
      gate,
    };
  });

  const allPassed = stageResults.every(r => r.status === 'success');
  const result = {
    status: allPassed ? 'success' : 'error',
    duration_ms: Date.now() - runStarted,
    stages: stageResults,
    session: state.session,
    run_id: state.run_id,
    case_id: spec.case_id,
    engine: {
      ...spec.engine,
      resolved_adapter: 'semi-auto',
      cli_version: 'manual',
    },
    usage: { availability: 'unavailable' },
    isolation: spec.isolation,
    human_review_status: 'pending',
    completed_at: new Date().toISOString(),
  };
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2));

  // Collect attestation.
  let attestationError = null;
  try {
    const caseRuntime = getCaseRuntime(projectRoot, spec.case_id);
    const { attestation, warnings } = await collectRunObservation({
      projectRoot,
      runRoot: runDir,
      caseId: spec.case_id,
      runId: state.run_id,
      caseRuntime,
    });
    writeAttestation(runDir, attestation);
    if (warnings.length) {
      console.warn(`[attestation] ${warnings.length} warning(s): ${warnings.join('; ')}`);
    }
  } catch (err) {
    attestationError = {
      message: err.message,
      code: err.code || 'ATTESTATION_FAILED',
      root_cause_hint: err.root_cause_hint || err.message,
    };
    result.attestation_error = attestationError;
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2));
    console.error(`[attestation] failed: ${err.message}`);
  }

  // Build human review package.
  const review = buildHumanReviewPackage({
    run_id: state.run_id,
    reviewer: 'pending-human-review',
    isolation: spec.isolation?.mode || 'file-isolated-development',
    reviews: [{ case_id: spec.case_id }],
  });
  writeFileSync(join(runDir, 'human-review.json'), JSON.stringify(review, null, 2));

  state.status = allPassed ? 'awaiting-evaluation' : 'run-failed';
  state.process_pid = null;
  state.completed_at = result.completed_at;
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const artifacts = [
    join(runDir, 'result.json'),
    join(runDir, 'human-review.json'),
    join(runDir, 'logs', 'git-status.txt'),
    join(runDir, 'artifacts', 'workspace.diff'),
  ];

  return {
    run_id: state.run_id,
    run_dir: runDir,
    status: allPassed ? 'success' : 'error',
    completed: true,
    allStagesComplete: true,
    result,
    attestation_error: attestationError,
    artifacts,
    next_actions: [
      `Run evaluation: node scripts/bench.mjs evaluate --run-dir "${runDir}"`,
      `Generate report: node scripts/bench.mjs report --run-dir "${runDir}"`,
    ],
  };
}

/**
 * Get current semi-auto run status.
 *
 * @param {string} runRoot
 */
export async function getSemiAutoStatus(runRoot) {
  const runDir = resolve(runRoot);
  const statePath = join(runDir, 'run-state.json');

  if (!existsSync(runDir)) {
    return {
      run_id: basename(runRoot),
      run_dir: runDir,
      status: 'unknown',
      error: `Run directory does not exist: ${runDir}`,
    };
  }

  if (!existsSync(statePath)) {
    return {
      run_id: basename(runDir),
      run_dir: runDir,
      status: 'unknown',
      error: `No run-state.json found in ${runDir}.`,
    };
  }

  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  if (state.status !== 'semi-auto-waiting' && state.status !== 'semi-auto-running') {
    return {
      run_id: state.run_id,
      run_dir: runDir,
      status: state.status,
      completedStages: state.scenario?.completed_stages || [],
      reminders: [`Run is in status "${state.status}", not semi-auto-waiting.`],
    };
  }

  const waitingOnStage = state.scenario?.current_stage || null;
  const completedStages = state.scenario?.completed_stages || [];
  const allStages = state.scenario?.stage_ids || [];
  const remainingStages = allStages.filter(s => !completedStages.includes(s));
  const checkpointPath = waitingOnStage
    ? join(runDir, 'workspace', '.vab', 'checkpoints', `${waitingOnStage}.json`)
    : null;
  const checkpointExists = checkpointPath && existsSync(checkpointPath);

  const reminders = [];
  if (waitingOnStage) {
    reminders.push(
      `Waiting for stage ${waitingOnStage} checkpoint.`,
      checkpointExists
        ? `Checkpoint file exists at ${checkpointPath} — run resume to advance.`
        : `Write checkpoint to .vab/checkpoints/${waitingOnStage}.json`,
    );
  } else {
    reminders.push('No stage waiting. All stages may be complete.');
  }

  return {
    run_id: state.run_id,
    run_dir: runDir,
    status: state.status,
    waitingOnStage,
    completedStages,
    remainingStages,
    checkpointExists,
    reminders,
  };
}

/**
 * Watch mode: monitor the workspace for checkpoint files and auto-advance
 * through all stages. When all stages complete, collect and optionally run
 * evaluation.
 *
 * @param {{ runRoot: string, projectRoot: string, timeoutMinutes: number }} params
 * @returns {Promise<object>}
 */
export async function watchSemiAutomaticSession({
  runRoot, projectRoot, timeoutMinutes = 180,
}) {
  const runDir = resolve(runRoot);
  const specPath = join(runDir, 'run-spec.json');
  const statePath = join(runDir, 'run-state.json');

  if (!existsSync(specPath) || !existsSync(statePath)) {
    throw new Error(`Run directory is not prepared: ${runDir}`);
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  if (!['semi-auto-waiting', 'semi-auto-running', 'prepared'].includes(state.status)) {
    throw new Error(`Run status must be semi-auto-waiting or prepared; got ${state.status}`);
  }

  // Convert prepared to semi-auto-waiting if needed.
  if (state.status === 'prepared') {
    state.status = 'semi-auto-waiting';
    state.session = state.session || {};
    state.session.semi_auto = true;
    state.session.continuity = 'manual-checkpoint';
    state.scenario = state.scenario || {};
    if (!state.scenario.current_stage) {
      const firstStage = state.scenario.stage_ids?.[0] || 'S0';
      state.scenario.current_stage = firstStage;
      state.scenario.completed_stages = [];
    }
    state.process_pid = process.pid;
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  state.status = 'semi-auto-running';
  state.process_pid = process.pid;
  state.active_window_started_at = new Date(Date.now()).toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const caseDir = join(projectRoot, 'cases', spec.case_id);
  const scenario = loadRunScenario(runDir, caseDir);
  const deadline = Date.now() + timeoutMinutes * 60_000;

  const workspaceDir = join(runDir, 'workspace');
  const inputDir = join(runDir, 'input');
  const logsDir = join(runDir, 'logs');
  const checkpointsDir = join(workspaceDir, '.vab', 'checkpoints');

  mkdirSync(checkpointsDir, { recursive: true });

  const stagePromptResolver = (sid) => {
    const s = scenario.stages.find(ss => ss.id === sid);
    if (!s) throw new Error(`Unknown stage: ${sid}`);
    return stagePrompt(caseDir, scenario, s);
  };

  let currentState = { ...state };
  const completedStages = new Set(currentState.scenario.completed_stages || []);

  // Identify next stage to wait for.
  let waitingStageId = currentState.scenario.current_stage;

  if (!waitingStageId || completedStages.has(waitingStageId)) {
    // Find first incomplete stage.
    waitingStageId = scenario.stages.find(s => !completedStages.has(s.id))?.id || null;
  }

  const stageResults = [];

  const waitForCheckpoint = (stageId, timeoutMs) => new Promise((resolveCheckpoint) => {
    const checkpointPath = join(checkpointsDir, `${stageId}.json`);

    // If already exists, resolve immediately.
    if (existsSync(checkpointPath)) {
      try {
        const cp = JSON.parse(readFileSync(checkpointPath, 'utf8'));
        if (cp.schema_version === 1 && cp.stage_id === stageId) {
          resolveCheckpoint({ completed: true, checkpoint: cp, checkpointPath });
          return;
        }
      } catch { /* invalid checkpoint, keep waiting */ }
    }

    const startTime = Date.now();
    let watcher = null;
    let timeout = null;

    const cleanup = () => {
      if (watcher) { watcher.close(); watcher = null; }
      if (timeout) { clearTimeout(timeout); timeout = null; }
    };

    const check = () => {
      if (existsSync(checkpointPath)) {
        try {
          const cp = JSON.parse(readFileSync(checkpointPath, 'utf8'));
          if (cp.schema_version === 1 && cp.stage_id === stageId) {
            cleanup();
            resolveCheckpoint({ completed: true, checkpoint: cp, checkpointPath });
            return true;
          }
        } catch { /* keep waiting */ }
      }
      return false;
    };

    // Poll every 2 seconds in case fs.watch is unreliable.
    const pollInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        cleanup();
        clearInterval(pollInterval);
        resolveCheckpoint({ completed: false, reason: 'timeout' });
        return;
      }
      if (check()) clearInterval(pollInterval);
    }, 2000);

    // Also use fs.watch for faster detection.
    try {
      watcher = fsWatch(checkpointsDir, (eventType, filename) => {
        if (filename === `${stageId}.json` && eventType === 'rename') {
          check();
        }
      });
      watcher.on('error', () => { /* fs.watch may fail on some systems */ });
    } catch {
      // fs.watch may not be available; poll interval is the fallback.
    }

    timeout = setTimeout(() => {
      cleanup();
      clearInterval(pollInterval);
      resolveCheckpoint({ completed: false, reason: 'timeout' });
    }, timeoutMs);
  });

  while (waitingStageId) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      stageResults.push({ stage_id: waitingStageId, status: 'error', error: 'watch budget exhausted' });
      break;
    }

    // Ensure stage prompt exists.
    const promptPath = join(inputDir, `stage-${waitingStageId}.md`);
    if (!existsSync(promptPath)) {
      await semiAutomaticAdapter.advanceStage(
        { paths: { inputDir, workspaceDir, logsDir, runDir }, scenario, stagePrompt: stagePromptResolver },
        waitingStageId,
      );
    }

    currentState.scenario.current_stage = waitingStageId;
    writeFileSync(statePath, JSON.stringify(currentState, null, 2));

    // Wait for checkpoint.
    const checkpoint = await waitForCheckpoint(waitingStageId, remaining);

    if (!checkpoint.completed) {
      stageResults.push({ stage_id: waitingStageId, status: 'error', error: checkpoint.reason || 'timeout' });
      break;
    }

    // Verify checkpoint gate.
    const stage = scenario.stages.find(s => s.id === waitingStageId);
    const gate = verifyCheckpointGate(workspaceDir, stage);
    const gateDir = join(logsDir, 'stages', waitingStageId);
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(join(gateDir, 'checkpoint-gate.json'), JSON.stringify(gate, null, 2));

    if (gate.status === 'error') {
      stageResults.push({
        stage_id: waitingStageId,
        status: 'error',
        error: `checkpoint gate failed: ${gate.missing.join(', ')}`,
        gate,
      });
      break;
    }

    // Mark stage complete.
    completedStages.add(waitingStageId);
    stageResults.push({ stage_id: waitingStageId, status: 'success', gate });
    currentState.scenario.completed_stages = [...completedStages];
    currentState.scenario.attempts = currentState.scenario.attempts || {};
    currentState.scenario.attempts[waitingStageId] = (currentState.scenario.attempts[waitingStageId] || 0) + 1;
    writeFileSync(statePath, JSON.stringify(currentState, null, 2));

    // Find next stage.
    const stageIndex = scenario.stages.findIndex(s => s.id === waitingStageId);
    waitingStageId = scenario.stages[stageIndex + 1]?.id || null;
  }

  // Collect results.
  const collectResult = await collectSemiAutoRun({
    runDir, spec, state: currentState, projectRoot, scenario, caseDir,
  });

  return collectResult;
}
