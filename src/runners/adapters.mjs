import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CLI Adapter 协议（VAB-T01）。
 *
 * 每个 Adapter 暴露同一组纯函数字段，不依赖进程 IO，便于在 fixture 日志上做快照测试：
 *
 *   id                —— 与 RunSpec.engine.adapter 对齐的稳定标识。
 *   executable        —— 默认可执行路径（可被 RunSpec.engine.executable 覆盖）。
 *   versionArgs       —— 探测版本用的参数。
 *   parseVersion(stdout|stderr) —— 从 --version 输出解析版本字符串，找不到时返回 null。
 *   session_continuity —— native | native-working-directory | synthetic 的会话连续性声明
 *                          （沿用 scripts/bench.mjs 读取的字段名，不在本任务内改名）。
 *   build(spec, runDir, stageId, session) —— 兼容 scripts/bench.mjs 的现有入口，
 *                                            返回 { executable, args, stdin, format }。
 *   buildCommand(ctx) —— 纯函数命令构建，输入仅依赖 ctx 字段，便于快照测试。
 *   redactCommand(command, ctx) —— 把 prompt/敏感值替换为占位符，写入日志前调用。
 */

const defaultExecutables = {
  codex: 'codex',
  kimi: '/Users/leozhou/.kimi-code/bin/kimi',
  claude: 'claude',
  pi: 'pi',
};

/**
 * 默认 Skill 目录，便于测试时注入空目录而不依赖真实 Run 目录。
 */
const defaultEmptySkillsDir = '/run/empty-skills';

function readPrompt(runDir, stageId) {
  return readFileSync(join(runDir, 'input', `stage-${stageId}.md`), 'utf8');
}

function revisionImagePaths(runDir, stageId) {
  if (stageId !== 'R0') return [];
  const revisionPath = join(runDir, 'revision.json');
  if (!existsSync(revisionPath)) return [];
  try {
    const revision = JSON.parse(readFileSync(revisionPath, 'utf8'));
    return (revision.references || [])
      .map(reference => reference?.path)
      .filter(path => typeof path === 'string')
      .map(path => join(runDir, 'workspace', path));
  } catch {
    return [];
  }
}

/**
 * 提取版本号中第一段看起来像 semver 的内容。
 * 对 "codex-cli 0.144.6"、"2.1.177"、"0.27.0" 都生效。
 */
export function parseSemverVersion(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

/**
 * 构造命令时使用的输入上下文。所有字段都显式声明，避免隐式依赖 RunSpec。
 *
 * @typedef {Object} AdapterCommandContext
 * @property {string} adapter                Adapter id。
 * @property {string} executable             实际可执行路径（已合并 RunSpec 覆盖）。
 * @property {string} model                  模型标识。
 * @property {string} workspace              工作目录绝对路径。
 * @property {string} outputDir              产物目录绝对路径。
 * @property {string} stageId                当前阶段 id。
 * @property {string} prompt                 当前阶段 prompt 文本（脱敏前）。
 * @property {{ id: string|null, started: boolean, resumeFrom?: string|null }} session
 *           会话状态：{ id, started, resumeFrom }。
 * @property {number|null} maxCostUsd        可选费用上限。
 * @property {string} emptySkillsDir         Kimi 的空 Skill 目录。
 * @property {string|null} reasoningEffort   Codex 思考强度（low / medium / high / xhigh）。
 * @property {string|null} modelProvider     Pi 实际模型 Provider（例如 deepseek）。
 * @property {boolean} networkEnabled        是否请求 Codex workspace-write 公网访问。
 * @property {string[]} imagePaths           初始 Prompt 的图片附件（仅支持的 Adapter 使用）。
 */

function buildCodexCommand(ctx) {
  const args = ['exec'];
  const session = ctx.session || {};
  const reasoningConfig = ctx.reasoningEffort
    ? ['-c', `model_reasoning_effort=${JSON.stringify(ctx.reasoningEffort)}`]
    : [];
  const imageArgs = !session.started && Array.isArray(ctx.imagePaths) && ctx.imagePaths.length
    ? ['--image', ...ctx.imagePaths]
    : [];
  if (session.started && (session.id || session.resumeFrom)) {
    args.push(
      'resume',
      ...reasoningConfig,
      '--config', 'sandbox_mode="workspace-write"',
      '--config', `sandbox_workspace_write.network_access=${ctx.networkEnabled === true}`,
      '--config', 'approval_policy="never"',
      '--model', ctx.model,
      '--ignore-user-config',
      '--ignore-rules',
      '--json',
      '--output-last-message', join(ctx.outputDir, `final-message-${ctx.stageId}.md`),
      session.id || session.resumeFrom,
      '-',
    );
  } else {
    args.push(
      ...reasoningConfig,
      '--cd', ctx.workspace,
      '--config', `sandbox_workspace_write.network_access=${ctx.networkEnabled === true}`,
      '--config', 'approval_policy="never"',
      '--model', ctx.model,
      '--sandbox', 'workspace-write',
      '--ignore-user-config',
      '--ignore-rules',
      '--json',
      '--output-last-message', join(ctx.outputDir, `final-message-${ctx.stageId}.md`),
      ...imageArgs,
      '-',
    );
  }
  return {
    executable: ctx.executable,
    args,
    stdin: ctx.prompt,
    format: 'jsonl',
  };
}

function buildKimiCommand(ctx) {
  // Kimi prompt mode is already non-interactive and uses auto permission
  // semantics. Official 0.27+ command docs reject --prompt combined with
  // --auto or --yolo, so do not add either approval flag here.
  const args = ['--model', ctx.model];
  const session = ctx.session || {};
  if (session.started) args.unshift('--continue');
  args.push(
    '--prompt', ctx.prompt,
    '--output-format', 'stream-json',
    '--skills-dir', ctx.emptySkillsDir || defaultEmptySkillsDir,
  );
  return {
    executable: ctx.executable,
    args,
    stdin: null,
    format: 'jsonl',
  };
}

function buildClaudeCommand(ctx) {
  const session = ctx.session || {};
  const args = [
    '--print',
    '--safe-mode',
    '--strict-mcp-config',
    '--no-chrome',
    '--model', ctx.model,
    '--permission-mode', 'auto',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-hook-events',
    '--tools', claudeTools(ctx.allowedTools).join(','),
  ];
  if (session.started && (session.id || session.resumeFrom)) {
    args.push('--resume', session.id || session.resumeFrom);
  } else if (session.id) {
    args.push('--session-id', session.id);
  }
  if (ctx.maxCostUsd != null) args.push('--max-budget-usd', String(ctx.maxCostUsd));
  return {
    executable: ctx.executable,
    args,
    stdin: ctx.prompt,
    format: 'jsonl',
  };
}

function buildPiCommand(ctx) {
  const session = ctx.session || {};
  // Pi 的 JSON event mode 会在长工具调用中反复输出完整消息，实测可能造成 GB 级日志。
  // 评测的原始过程与最终交付已由 workspace/checkpoint 保留，因此采用 print mode；
  // 阶段间通过同一 session-dir 中的 --continue 保持原生会话连续性。
  const args = [
    '--mode', 'print',
    '--approve',
    '--no-context-files',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--session-dir', join(ctx.outputDir, '..', '.pi-sessions'),
    '--tools', 'read,bash,edit,write,grep,find,ls',
  ];
  if (ctx.modelProvider) args.push('--provider', ctx.modelProvider);
  args.push('--model', ctx.model);
  if (session.started) args.push('--continue');
  args.push(ctx.prompt);
  return {
    executable: ctx.executable,
    args,
    stdin: null,
    format: 'text',
  };
}

function claudeTools(allowed = []) {
  const set = new Set(allowed);
  return [
    ...(set.has('shell') ? ['Bash'] : []),
    ...(set.has('file_read') ? ['Read', 'Glob', 'Grep'] : []),
    ...(set.has('file_write') ? ['Edit', 'Write'] : []),
    ...(set.has('public_web') ? ['WebFetch', 'WebSearch'] : []),
  ];
}

function networkEnabled(value) {
  return value === true || value === 'enabled';
}

/**
 * 把 ctx.executable 默认化，便于 buildCommand 在测试时不依赖 spec。
 */
function resolveExecutable(adapter, executableOverride) {
  return executableOverride || defaultExecutables[adapter];
}

const adapters = {
  codex: {
    id: 'codex',
    executable: defaultExecutables.codex,
    versionArgs: ['--version'],
    session_continuity: 'native',
    parseVersion(output) {
      return parseSemverVersion(output || '');
    },
    build(spec, runDir, stageId, session) {
      const outputDir = join(runDir, 'artifacts');
      const prompt = readPrompt(runDir, stageId);
      return buildCodexCommand({
        adapter: 'codex',
        executable: resolveExecutable('codex', spec.engine.executable),
        model: spec.engine.model,
        workspace: join(runDir, 'workspace'),
        outputDir,
        stageId,
        prompt,
        session: session || {},
        reasoningEffort: spec.engine.reasoning_effort || null,
        networkEnabled: networkEnabled(spec.isolation?.network),
        imagePaths: revisionImagePaths(runDir, stageId),
      });
    },
    buildCommand: buildCodexCommand,
  },
  kimi: {
    id: 'kimi',
    executable: defaultExecutables.kimi,
    versionArgs: ['--version'],
    session_continuity: 'native-working-directory',
    parseVersion(output) {
      return parseSemverVersion(output || '');
    },
    build(spec, runDir, stageId, session) {
      const prompt = readPrompt(runDir, stageId);
      return buildKimiCommand({
        adapter: 'kimi',
        executable: resolveExecutable('kimi', spec.engine.executable),
        model: spec.engine.model,
        workspace: join(runDir, 'workspace'),
        outputDir: join(runDir, 'artifacts'),
        stageId,
        prompt,
        session: session || {},
        emptySkillsDir: join(runDir, '.empty-skills'),
      });
    },
    buildCommand: buildKimiCommand,
  },
  claude: {
    id: 'claude',
    executable: defaultExecutables.claude,
    versionArgs: ['--version'],
    session_continuity: 'native',
    parseVersion(output) {
      return parseSemverVersion(output || '');
    },
    build(spec, runDir, stageId, session) {
      const prompt = readPrompt(runDir, stageId);
      return buildClaudeCommand({
        adapter: 'claude',
        executable: resolveExecutable('claude', spec.engine.executable),
        model: spec.engine.model,
        workspace: join(runDir, 'workspace'),
        outputDir: join(runDir, 'artifacts'),
        stageId,
        prompt,
        session: session || {},
        maxCostUsd: spec.budget?.max_cost_usd ?? null,
        allowedTools: spec.permissions?.allowed_tools || [],
      });
    },
    buildCommand: buildClaudeCommand,
  },
  pi: {
    id: 'pi',
    executable: defaultExecutables.pi,
    versionArgs: ['--version'],
    session_continuity: 'native-working-directory',
    parseVersion(output) {
      return parseSemverVersion(output || '');
    },
    build(spec, runDir, stageId, session) {
      const prompt = readPrompt(runDir, stageId);
      return buildPiCommand({
        adapter: 'pi',
        executable: resolveExecutable('pi', spec.engine.executable),
        model: spec.engine.model,
        modelProvider: spec.engine.model_provider || null,
        workspace: join(runDir, 'workspace'),
        outputDir: join(runDir, 'artifacts'),
        stageId,
        prompt,
        session: session || {},
      });
    },
    buildCommand: buildPiCommand,
  },
};

export function getAdapter(engine) {
  const adapter = adapters[engine];
  if (!adapter) throw new Error(`Unsupported engine: ${engine}`);
  return adapter;
}

export function listAdapters() {
  return ['codex', 'kimi', 'claude', 'pi'].map(getAdapter);
}

/**
 * 把命令脱敏为可写入 command.json 的形式。
 * prompt 是模型可见输入，但可能很长且包含 fixture 文本，统一替换为占位符。
 * 不读取凭据，也不需要额外屏蔽 —— Adapter 的命令里不携带凭据值（凭据通过 Secret 引用注入环境变量）。
 */
export function redactCommand(command, ctx = {}) {
  const prompt = ctx.prompt;
  const seenPrompt = typeof prompt === 'string' && prompt.length > 0;
  const args = (command.args || []).map(arg => {
    if (seenPrompt && arg === prompt) return '<PROMPT>';
    if (seenPrompt && typeof arg === 'string' && arg.length > 64 && arg.includes(prompt)) return '<PROMPT>';
    return arg;
  });
  return {
    executable: command.executable,
    args,
    stdin: command.stdin == null ? null : (seenPrompt && command.stdin === prompt ? '<PROMPT>' : '<STDIN>'),
    format: command.format || null,
  };
}
