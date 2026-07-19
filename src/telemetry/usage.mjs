/**
 * VAB-T01 Token / Cost provenance。
 *
 * 规则（来自 RUN_LOG_SPEC.md 与 task prompt）：
 *   - 只有 CLI / provider 明确返回 usage 时才记录数值；
 *   - 拿不到 token 时记录 unavailable + reason，禁止根据文字长度估算；
 *   - 只有 provider 明确给出费用时才记录精确 cost；
 *   - 已知 token 但无单价：记 token，cost 标 unavailable；
 *   - estimated 默认禁用；调用方必须显式开启，否则降级为 unavailable；
 *   - provenance 取值：native_cli | provider_api | estimated | unavailable。
 *
 * 该模块不读取任何环境变量，也不写文件。它只对输入事件做纯函数归并。
 */

export const USAGE_PROVENANCE = Object.freeze({
  NATIVE_CLI: 'native_cli',
  PROVIDER_API: 'provider_api',
  ESTIMATED: 'estimated',
  UNAVAILABLE: 'unavailable',
});

/**
 * 默认禁用 estimated —— 调用方需要显式 allowEstimate=true 才会启用。
 */
export function emptyUsage(provenance = USAGE_PROVENANCE.UNAVAILABLE, reason = 'no usage reported by CLI') {
  return {
    input_tokens: null,
    output_tokens: null,
    cached_tokens: null,
    total_tokens: null,
    cost_usd: null,
    provenance,
    reason,
    source_events: [],
  };
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function pickFirstFinite(values) {
  for (const value of values) {
    if (isFiniteNonNegativeNumber(value)) return value;
  }
  return null;
}

function pickFirstStringCostUsd(values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '' || /^null$/i.test(trimmed) || /^n\/a$/i.test(trimmed)) continue;
      const parsed = Number(trimmed.replace(/[^0-9.+-]/g, ''));
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

/**
 * 从单个事件对象（归一化事件的 data 字段，或原始 JSONL 行）提取 usage。
 * 返回 { tokens, cost_usd, provenance, origin } 或 null（当事件无 usage 时）。
 *
 * 支持多种来源形状：
 *   - Codex JSONL：{ usage: { input_tokens, output_tokens, ... } }
 *   - Claude stream-json：{ message: { usage: { input_tokens, output_tokens, cache_creation_input_tokens, ... } } }
 *                  或顶层 { total_cost_usd }
 *   - Kimi stream-json：{ usage: {...}, cost_usd }
 *   - 顶层 { input_tokens, output_tokens }
 */
export function extractUsage(event) {
  if (event == null) return null;
  const candidates = [event];
  if (event.message && typeof event.message === 'object') candidates.push(event.message);
  if (event.data && typeof event.data === 'object') candidates.push(event.data);

  let usageObj = null;
  let origin = null;
  for (const candidate of candidates) {
    if (candidate && typeof candidate.usage === 'object' && candidate.usage != null) {
      usageObj = candidate.usage;
      origin = candidate === event ? 'usage' : (candidate === event.message ? 'message.usage' : 'data.usage');
      break;
    }
  }
  if (!usageObj) {
    const topLevelTokens = pickFirstFinite([event.input_tokens, event.output_tokens]);
    if (topLevelTokens == null) return null;
    origin = 'top-level';
    usageObj = event;
  }

  const inputTokens = pickFirstFinite([
    usageObj.input_tokens,
    usageObj.inputTokens,
  ]);
  const outputTokens = pickFirstFinite([
    usageObj.output_tokens,
    usageObj.outputTokens,
  ]);
  const cachedTokens = pickFirstFinite([
    usageObj.cached_tokens,
    usageObj.cachedTokens,
    usageObj.cache_read_input_tokens,
  ]);
  const totalTokens = pickFirstFinite([
    usageObj.total_tokens,
    usageObj.totalTokens,
  ]) ?? ((inputTokens != null || outputTokens != null)
    ? ((inputTokens ?? 0) + (outputTokens ?? 0) + (cachedTokens ?? 0) || null)
    : null);

  const costUsd = pickFirstFinite([
    usageObj.cost_usd,
    usageObj.costUsd,
    event.cost_usd,
    event.costUsd,
    event.total_cost_usd,
    event.totalCostUsd,
  ]) ?? pickFirstStringCostUsd([
    usageObj.cost_usd,
    usageObj.costUsd,
    event.cost_usd,
    event.costUsd,
  ]);

  if (inputTokens == null && outputTokens == null && totalTokens == null && costUsd == null) {
    return null;
  }

  // 原始事件里显式带 cost 字段时算 provider_api；否则 native_cli。
  const hasExplicitCost = usageObj.cost_usd != null || usageObj.costUsd != null
    || event.cost_usd != null || event.costUsd != null
    || event.total_cost_usd != null || event.totalCostUsd != null;
  const provenance = hasExplicitCost ? USAGE_PROVENANCE.PROVIDER_API : USAGE_PROVENANCE.NATIVE_CLI;

  return {
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cached: cachedTokens,
      total: totalTokens,
    },
    cost_usd: costUsd,
    provenance,
    origin,
  };
}

/**
 * 把事件流归并为一次 Run/Stage 的总 usage。
 *
 * @param {Array<Object>} events 归一化事件的 data 字段或原始事件对象。
 * @param {Object} [options]
 * @param {boolean} [options.allowEstimate=false] 是否允许在无 usage 时退化为 estimated。
 *        默认 false —— 拿不到时返回 unavailable。
 * @param {number|null} [options.estimatedInputTokens] 调用方显式提供的估算输入 token。
 *        仅当 allowEstimate=true 时才会写入。
 * @param {number|null} [options.estimatedOutputTokens]
 * @returns 总 usage 对象。
 */
export function aggregateUsage(events, options = {}) {
  const allowEstimate = options.allowEstimate === true;
  const sourceEvents = [];

  let input = 0;
  let output = 0;
  let cached = 0;
  let cost = 0;
  let sawAny = false;
  let sawCost = false;

  for (const event of events || []) {
    const extracted = extractUsage(event);
    if (!extracted) continue;
    sourceEvents.push({
      origin: extracted.origin,
      input: extracted.tokens.input,
      output: extracted.tokens.output,
      cached: extracted.tokens.cached,
      total: extracted.tokens.total,
      cost_usd: extracted.cost_usd,
      provenance: extracted.provenance,
    });
    if (extracted.tokens.input != null) input += extracted.tokens.input;
    if (extracted.tokens.output != null) output += extracted.tokens.output;
    if (extracted.tokens.cached != null) cached += extracted.tokens.cached;
    if (extracted.cost_usd != null) {
      cost += extracted.cost_usd;
      sawCost = true;
    }
    sawAny = true;
  }

  if (sawAny) {
    const total = input + output + cached;
    return {
      input_tokens: input || null,
      output_tokens: output || null,
      cached_tokens: cached || null,
      total_tokens: total || null,
      cost_usd: sawCost ? Number(cost.toFixed(6)) : null,
      provenance: sawCost ? USAGE_PROVENANCE.PROVIDER_API : USAGE_PROVENANCE.NATIVE_CLI,
      reason: null,
      source_events: sourceEvents,
    };
  }

  if (allowEstimate) {
    const estIn = Number.isFinite(options.estimatedInputTokens) ? options.estimatedInputTokens : null;
    const estOut = Number.isFinite(options.estimatedOutputTokens) ? options.estimatedOutputTokens : null;
    if (estIn == null && estOut == null) {
      return emptyUsage(USAGE_PROVENANCE.UNAVAILABLE, 'allowEstimate=true but no estimate provided');
    }
    const estTotal = (estIn ?? 0) + (estOut ?? 0);
    return {
      input_tokens: estIn,
      output_tokens: estOut,
      cached_tokens: null,
      total_tokens: estTotal || null,
      cost_usd: null,
      provenance: USAGE_PROVENANCE.ESTIMATED,
      reason: 'no native usage; explicit caller-provided estimate',
      source_events: [],
    };
  }

  return emptyUsage(USAGE_PROVENANCE.UNAVAILABLE, 'no usage reported by CLI and allowEstimate=false');
}
