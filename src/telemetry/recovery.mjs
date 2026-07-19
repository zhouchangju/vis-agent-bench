/**
 * VAB-T01 恢复行为。
 *
 * 输入归一化 stats + StageTiming + exit code，输出确定性的恢复描述：
 *   - 是否需要恢复；
 *   - 已恢复 / 未恢复；
 *   - 诊断码（truncated_output | unknown_events | empty_output | non_zero_exit | timeout | killed | ok）；
 *   - root_cause_hint；
 *   - safe_retry；
 *   - stop_condition。
 *
 * 不修改原始日志，不删除已收集的证据 —— task prompt 明确要求“终止后仍需 collect，保留失败证据”。
 */

import { KNOWN_EVENT_TYPES } from './events.mjs';

/**
 * @typedef {Object} RecoveryInput
 * @property {Object} stats normalizeStdout 返回的 stats（可选）。
 * @property {Object} timing buildStageTiming 返回的 StageTiming（可选）。
 * @property {number|null} [exit_code]
 * @property {boolean} [timed_out]
 * @property {boolean} [empty_output]
 */

function knownTypeSet() {
  return new Set(KNOWN_EVENT_TYPES);
}

/**
 * 综合判断阶段输出与退出的恢复状态。
 *
 * @param {RecoveryInput} input
 * @returns {{
 *   status: 'ok' | 'recovered' | 'unrecovered',
 *   codes: string[],
 *   root_cause_hint: string,
 *   safe_retry: string,
 *   stop_condition: string,
 *   evidence_preserved: boolean,
 * }}
 */
export function diagnoseRecovery(input = {}) {
  const codes = [];
  const stats = input.stats || null;
  const timing = input.timing || null;
  const known = knownTypeSet();

  const truncatedCount = stats?.truncated ?? 0;
  const unknownTypes = stats?.unknown_types instanceof Set ? [...stats.unknown_types] : [];
  const empty = (stats?.lines ?? null) === 0
    || (stats && (stats.json_ok + stats.truncated + stats.plain) === 0)
    || input.empty_output === true
    || timing?.empty_output === true;
  const exitCode = input.exit_code ?? timing?.exit_code ?? null;
  const timedOut = input.timed_out === true || timing?.timed_out === true;
  const signal = timing?.signal ?? null;

  if (timedOut) {
    codes.push('timeout');
    if (signal) codes.push('killed');
  }
  if (exitCode != null && exitCode !== 0) codes.push('non_zero_exit');
  if (truncatedCount > 0) codes.push('truncated_output');
  if (unknownTypes.length > 0) codes.push('unknown_events');
  if (empty) codes.push('empty_output');

  if (codes.length === 0) {
    return ok();
  }

  const recoveredFromMalformed = (truncatedCount > 0 || unknownTypes.length > 0)
    && (exitCode == null || exitCode === 0)
    && !timedOut;

  const status = recoveredFromMalformed ? 'recovered' : 'unrecovered';

  return {
    status,
    codes,
    root_cause_hint: buildRootCause({ codes, truncatedCount, unknownTypes, exitCode, timedOut, signal, empty }),
    safe_retry: 'Rerun the stage on the same workspace; if the failure repeats, capture CLI version and re-prepare the Run.',
    stop_condition: 'Stop after two identical stage failures; preserve raw stdout/stderr before retry.',
    evidence_preserved: true,
  };
}

function ok() {
  return {
    status: 'ok',
    codes: [],
    root_cause_hint: '',
    safe_retry: '',
    stop_condition: '',
    evidence_preserved: true,
  };
}

function buildRootCause(parts) {
  const fragments = [];
  if (parts.codes.includes('timeout')) {
    fragments.push(parts.signal
      ? `CLI exceeded stage wall budget and was terminated with ${parts.signal}; final output may be incomplete.`
      : 'CLI exceeded stage wall budget; final output may be incomplete.');
  }
  if (parts.codes.includes('non_zero_exit')) {
    fragments.push(`CLI exited with code ${parts.exitCode}; check stderr.raw for the agent-reported error.`);
  }
  if (parts.codes.includes('truncated_output')) {
    fragments.push(`${parts.truncatedCount} truncated JSONL line(s) observed; the CLI stream was cut mid-event.`);
  }
  if (parts.codes.includes('unknown_events')) {
    fragments.push(`${parts.unknownTypes.length} unknown event type(s): ${parts.unknownTypes.slice(0, 5).join(', ')}.`);
  }
  if (parts.codes.includes('empty_output')) {
    fragments.push('CLI produced no usable stdout; verify adapter command and credential presence.');
  }
  return fragments.join(' ') || 'Stage produced unexpected output.';
}

/**
 * 从一个归一化 + timing 结果生成符合 CONTROL_PROTOCOL 的 recovery envelope 字段。
 * 上游（VAB-T08 接线或本任务的 Adapter 测试）可直接展开到 result envelope 的 error 块。
 */
export function toRecoveryEnvelope(input = {}) {
  const diagnosis = diagnoseRecovery(input);
  if (diagnosis.status === 'ok') return null;
  return {
    root_cause_hint: diagnosis.root_cause_hint,
    safe_retry: diagnosis.safe_retry,
    stop_condition: diagnosis.stop_condition,
    recovery_status: diagnosis.status,
    recovery_codes: diagnosis.codes,
    evidence_preserved: diagnosis.evidence_preserved,
  };
}
