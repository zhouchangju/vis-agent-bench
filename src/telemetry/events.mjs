/**
 * VAB-T01 归一化事件解析。
 *
 * 输入是 CLI stdout（jsonl 或 plain text），输出是 RUN_LOG_SPEC.md 中规定的归一化事件流。
 *
 * 必须容忍的故障模式（来自 task prompt 与 RUN_LOG_SPEC）：
 *   - 截断的 JSONL 行（CLI 被超时杀掉，最后一行不完整）；
 *   - 未知事件类型；
 *   - 混合输出（JSONL 与非 JSON 文本交错）；
 *   - 完全空输出；
 *   - 非零退出但仍有部分输出。
 *
 * 所有解析函数都是纯函数，方便在 fixture 文本上做确定性测试。
 */

/**
 * @typedef {Object} NormalizeOptions
 * @property {string} runId
 * @property {string} source            Adapter id（codex / kimi / claude）。
 * @property {string|null} [stageId]
 * @property {string|null} [ingestedAt] 显式 ISO 时间戳，便于测试断言；默认 new Date().toISOString()。
 */

/**
 * 解析单行文本为事件 payload。返回 { ok, payload, raw, kind }。
 *   kind:
 *     - 'json'      完整 JSON 对象
 *     - 'truncated' 看起来像 JSON 但解析失败（截断或不完整）
 *     - 'plain'     非 JSON 文本
 */
export function parseLine(line) {
  const raw = line;
  if (typeof line !== 'string') return { ok: false, payload: null, raw: '', kind: 'plain' };
  const trimmed = line.trim();
  if (trimmed === '') return { ok: false, payload: null, raw, kind: 'empty' };

  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (looksJson) {
    try {
      const data = JSON.parse(trimmed);
      return { ok: true, payload: data, raw, kind: 'json' };
    } catch {
      return { ok: false, payload: null, raw, kind: 'truncated' };
    }
  }
  return { ok: false, payload: trimmed, raw, kind: 'plain' };
}

/**
 * CLI 私有事件名 → 标准事件字典的别名映射。
 * Codex / Claude / Kimi 的 JSONL 用各自的事件名，归一化时统一回 RUN_LOG_SPEC 的字典。
 */
const TYPE_ALIASES = new Map([
  // Claude stream-json
  ['assistant', 'assistant.message'],
  ['system', 'session.info'],
  ['tool_use', 'tool.started'],
  ['tool_result', 'tool.ended'],
  ['result', 'usage.report'],
  // Kimi stream-json 使用 event 字段
  ['message.start', 'assistant.message'],
  ['message.delta', 'assistant.message'],
  ['message.end', 'assistant.message'],
]);

function classifyType(parsed) {
  if (parsed.kind === 'json' && parsed.payload != null) {
    if (typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)) {
      const explicit = parsed.payload.type || parsed.payload.event || parsed.payload.event_type;
      if (typeof explicit === 'string' && explicit.length > 0) {
        return TYPE_ALIASES.get(explicit) || explicit;
      }
      return inferTypeFromShape(parsed.payload);
    }
    return 'process.output';
  }
  return 'process.output';
}

function inferTypeFromShape(payload) {
  if (typeof payload.message === 'string' || Array.isArray(payload.content)) return 'assistant.message';
  if (payload.tool || payload.tool_name || payload.toolName) {
    return typeof payload.output === 'undefined' && typeof payload.result === 'undefined'
      ? 'tool.started'
      : 'tool.ended';
  }
  if (typeof payload.session_id === 'string' || typeof payload.thread_id === 'string') return 'session.info';
  if (typeof payload.usage === 'object' && payload.usage != null) return 'usage.report';
  return 'process.output';
}

function summarize(parsed) {
  if (parsed.kind === 'plain') return truncate(parsed.payload, 240);
  if (parsed.kind === 'truncated') return truncate(parsed.raw.trim(), 240);
  if (parsed.payload == null) return '';
  const p = parsed.payload;
  if (typeof p === 'string') return truncate(p, 240);
  if (typeof p.text === 'string') return truncate(p.text, 240);
  if (typeof p.message === 'string') return truncate(p.message, 240);
  if (typeof p.summary === 'string') return truncate(p.summary, 240);
  return 'CLI event';
}

function truncate(value, max) {
  if (typeof value !== 'string') return '';
  const sliced = value.length > max ? value.slice(0, max) : value;
  return value.length > max ? `${sliced}…` : sliced;
}

/**
 * 把任意 stdout 文本（jsonl/plain）转为归一化事件数组。
 *
 * 返回结构（确定性，便于快照测试）：
 *
 *   {
 *     events:   [{ ts, run_id, stage_id, seq, source, type, status, summary, data, raw_ref }],
 *     stats: {
 *       lines, json_ok, truncated, plain, empty,
 *       truncated_lines: [{ seq, raw }],
 *       unknown_types: Set<string>,
 *     },
 *     empty: bool,
 *   }
 *
 * `unknown_types` 收集所有不在 RUN_LOG_SPEC 事件字典中的类型，便于上游决定是否记 warning。
 * 截断行仍会被映射成一个 type='process.output' status='recovered' 的事件，保留原始证据。
 */
export function normalizeStdout(text, options = {}) {
  const runId = options.runId ?? null;
  const source = options.source ?? 'unknown';
  const stageId = options.stageId ?? null;
  const ingestedAt = options.ingestedAt ?? new Date().toISOString();

  const knownTypes = new Set(KNOWN_EVENT_TYPES);
  const stats = {
    lines: 0,
    json_ok: 0,
    truncated: 0,
    plain: 0,
    empty: 0,
    truncated_lines: [],
    unknown_types: new Set(),
  };
  const events = [];

  if (typeof text !== 'string' || text.length === 0) {
    return {
      events,
      stats,
      empty: true,
    };
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const last = i === lines.length - 1;
    // split 会在尾部产生一个空字符串；不要把它算作 empty line。
    if (last && line === '' && lines.length > 1) continue;
    const parsed = parseLine(line);
    stats.lines += 1;

    if (parsed.kind === 'empty') {
      stats.empty += 1;
      continue;
    }
    if (parsed.kind === 'plain') stats.plain += 1;
    else if (parsed.kind === 'truncated') {
      stats.truncated += 1;
      stats.truncated_lines.push({ seq: events.length + 1, raw: truncate(parsed.raw, 240) });
    } else if (parsed.kind === 'json') stats.json_ok += 1;

    const type = classifyType(parsed);
    if (!knownTypes.has(type)) stats.unknown_types.add(type);

    const status = parsed.kind === 'truncated' ? 'recovered' : 'success';
    const summary = summarize(parsed);
    events.push({
      ts: ingestedAt,
      run_id: runId,
      stage_id: stageId,
      seq: events.length + 1,
      source,
      type,
      status,
      summary,
      data: parsed.kind === 'json' ? parsed.payload : (parsed.kind === 'plain' ? { text: parsed.payload } : { text: parsed.raw, truncated: true }),
      raw_ref: `stdout.raw#L${i + 1}`,
    });
  }

  return {
    events,
    stats,
    empty: events.length === 0,
  };
}

/**
 * 标准事件类型，来自 docs/design/RUN_LOG_SPEC.md。
 * 上游可据此把 unknown_types 中不在此列表的归类为“未知事件”。
 */
export const KNOWN_EVENT_TYPES = Object.freeze([
  'run.created',
  'isolation.preflight',
  'stage.started',
  'stage.context.sent',
  'requirement.ledger.updated',
  'stage.checkpoint',
  'process.started',
  'assistant.message',
  'tool.started',
  'tool.ended',
  'file.changed',
  'clarification.requested',
  'clarification.answered',
  'budget.warning',
  'process.ended',
  'evaluator.started',
  'evaluator.ended',
  'human.review',
  'human.intervention',
  'stage.ended',
  'run.completed',
  // 归一化器自身使用的常见 CLI 形状，不与上述字典冲突。
  'process.output',
  'session.info',
  'usage.report',
]);

/**
 * 提取会话 id，用于 resume 后续阶段。
 * 与 scripts/bench.mjs 中 findSessionId 行为保持一致，但作为纯函数暴露。
 */
export function findSessionId(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const id = event.thread_id || event.session_id || event.sessionId
        || event.data?.thread_id || event.data?.session_id || event.data?.sessionId;
      if (typeof id === 'string' && id.length > 8) return id;
    } catch {
      // 忽略非 JSON 行
    }
  }
  return null;
}
