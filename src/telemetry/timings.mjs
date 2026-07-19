/**
 * VAB-T01 进程时间与阶段时间记录。
 *
 * 时间口径与 RUN_LOG_SPEC 对齐：
 *   - wall time：CLI 进程自然时间（start → close/kill）；
 *   - stage time：单个阶段从 send 到 collect 的总耗时；
 *   - run time：Run 创建到 Run 完成（包含 prepare/normalize 等）；
 *   - idle/timeout：超时与等待类时间必须与实际执行时间分开。
 *
 * 全部以毫秒整数返回；时间源由调用方注入，便于测试。
 */

/**
 * @typedef {Object} StageTiming
 * @property {string} stage_id
 * @property {number} wall_ms             CLI 进程自然时间（process wall）。
 * @property {number} cpu_ms              可观察到的 CPU 时间；不可得时为 null。
 * @property {number|null} stream_ms      首字节到末字节的时间；未观察时为 null。
 * @property {number|null} first_byte_ms  start → 首个事件的时间；未观察时为 null。
 * @property {number|null} last_byte_ms   start → 最后事件的时间；未观察时为 null。
 * @property {number} exit_code           退出码；null 表示进程未结束或被 signal 杀掉。
 * @property {string|null} signal         POSIX signal，如 'SIGTERM'。
 * @property {boolean} timed_out          是否被本任务的超时器杀掉。
 * @property {boolean} empty_output       stdout 是否为空。
 * @property {string} status              success | error | timeout | recovered。
 * @property {string} time_source         'harness_clock' | 'cli_event' —— 时间数值的来源。
 */

/**
 * 从阶段执行的 raw 观察值生成确定性的 StageTiming。
 *
 * @param {Object} input
 * @param {string} input.stage_id
 * @param {number} input.started_at_ms    spawn 前后注入的时间戳（毫秒）。
 * @param {number} input.ended_at_ms      close/kill 注入的时间戳（毫秒）。
 * @param {number|null} [input.first_byte_at_ms]
 * @param {number|null} [input.last_byte_at_ms]
 * @param {number|null} [input.cpu_ms]
 * @param {number|null} input.exit_code
 * @param {string|null} [input.signal]
 * @param {boolean} [input.timed_out]
 * @param {boolean} [input.empty_output]
 * @param {string} [input.time_source]
 */
export function buildStageTiming(input) {
  if (input == null) throw new Error('buildStageTiming requires an input object');
  if (typeof input.stage_id !== 'string') throw new Error('buildStageTiming requires stage_id');
  if (typeof input.started_at_ms !== 'number' || typeof input.ended_at_ms !== 'number') {
    throw new Error('buildStageTiming requires numeric started_at_ms and ended_at_ms');
  }
  const wallMs = Math.max(0, Math.round(input.ended_at_ms - input.started_at_ms));
  const firstByteMs = input.first_byte_at_ms != null
    ? Math.max(0, Math.round(input.first_byte_at_ms - input.started_at_ms))
    : null;
  const lastByteMs = input.last_byte_at_ms != null
    ? Math.max(0, Math.round(input.last_byte_at_ms - input.started_at_ms))
    : null;
  const streamMs = firstByteMs != null && lastByteMs != null
    ? Math.max(0, lastByteMs - firstByteMs)
    : null;
  const timedOut = input.timed_out === true;

  let status;
  if (timedOut) status = 'timeout';
  else if (input.exit_code != null && input.exit_code !== 0) status = 'error';
  else if (input.empty_output === true) status = 'error';
  else if (input.exit_code === 0) status = 'success';
  else status = 'error';

  return {
    stage_id: input.stage_id,
    wall_ms: wallMs,
    cpu_ms: typeof input.cpu_ms === 'number' ? Math.max(0, Math.round(input.cpu_ms)) : null,
    stream_ms: streamMs,
    first_byte_ms: firstByteMs,
    last_byte_ms: lastByteMs,
    exit_code: input.exit_code ?? null,
    signal: input.signal ?? null,
    timed_out: timedOut,
    empty_output: input.empty_output === true,
    status,
    time_source: input.time_source || 'harness_clock',
  };
}

/**
 * @typedef {Object} RunTiming
 * @property {number} wall_ms
 * @property {number} stage_count
 * @property {number} success_stage_count
 * @property {number} error_stage_count
 * @property {number|null} first_stage_first_byte_ms
 * @property {number|null} last_stage_last_byte_ms
 * @property {number} timed_out_stage_count
 * @property {boolean} any_empty_output
 * @property {string} time_source
 */

/**
 * 把多个 StageTiming 聚合成 Run 级时间统计。
 *
 * @param {Array<StageTiming>} stages
 * @param {Object} [options]
 * @param {number} [options.run_started_at_ms]
 * @param {number} [options.run_ended_at_ms]
 */
export function aggregateRunTiming(stages, options = {}) {
  const list = Array.isArray(stages) ? stages : [];
  const successStages = list.filter(s => s.status === 'success').length;
  // 任何非 success 的阶段（error / timeout / 其它）都算失败。
  const errorStages = list.filter(s => s.status !== 'success').length;
  const timedOutStages = list.filter(s => s.timed_out).length;
  const anyEmpty = list.some(s => s.empty_output);
  const firstStageFirstByte = list
    .map(s => s.first_byte_ms)
    .filter(v => v != null)
    .sort((a, b) => a - b)[0] ?? null;
  const lastStageLastByte = list
    .map(s => s.last_byte_ms)
    .filter(v => v != null)
    .sort((a, b) => b - a)[0] ?? null;

  let runWallMs;
  if (typeof options.run_started_at_ms === 'number' && typeof options.run_ended_at_ms === 'number') {
    runWallMs = Math.max(0, Math.round(options.run_ended_at_ms - options.run_started_at_ms));
  } else {
    runWallMs = list.reduce((acc, s) => acc + (s.wall_ms || 0), 0);
  }

  return {
    wall_ms: runWallMs,
    stage_count: list.length,
    success_stage_count: successStages,
    error_stage_count: errorStages,
    first_stage_first_byte_ms: firstStageFirstByte,
    last_stage_last_byte_ms: lastStageLastByte,
    timed_out_stage_count: timedOutStages,
    any_empty_output: anyEmpty,
    time_source: 'harness_clock',
  };
}
