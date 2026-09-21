import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getAdapter,
  listAdapters,
  parseSemverVersion,
  redactCommand,
} from '../../src/runners/adapters.mjs';
import {
  KNOWN_EVENT_TYPES,
  findSessionId,
  normalizeStdout,
  parseLine,
} from '../../src/telemetry/events.mjs';
import {
  USAGE_PROVENANCE,
  aggregateUsage,
  emptyUsage,
  extractUsage,
  preferTerminalUsageEvents,
} from '../../src/telemetry/usage.mjs';
import {
  aggregateRunTiming,
  buildStageTiming,
} from '../../src/telemetry/timings.mjs';
import {
  diagnoseRecovery,
  toRecoveryEnvelope,
} from '../../src/telemetry/recovery.mjs';

const fixturesDir = resolve(import.meta.dirname, 'fixtures');
const FIXED_TS = '2026-07-19T10:00:00.000Z';

function fixture(name) {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

const checks = [];

function check(name, fn) {
  checks.push([name, fn]);
}

/* ------------------------------------------------------------------ */
/* Adapter 命令快照（四个 Adapter，纯函数 buildCommand）                */
/* ------------------------------------------------------------------ */

check('codex adapter builds a fresh-session exec command deterministically', () => {
  const adapter = getAdapter('codex');
  const command = adapter.buildCommand({
    adapter: 'codex',
    executable: 'codex',
    model: 'gpt-example',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S0',
    prompt: 'do the thing',
    session: { id: null, started: false },
    reasoningEffort: 'medium',
    networkEnabled: true,
  });
  assert.equal(command.executable, 'codex');
  assert.equal(command.format, 'jsonl');
  assert.equal(command.stdin, 'do the thing');
  assert.deepEqual(command.args, [
    'exec',
    '-c', 'model_reasoning_effort="medium"',
    '--cd', '/run/w',
    '--config', 'sandbox_workspace_write.network_access=true',
    '--config', 'approval_policy="never"',
    '--model', 'gpt-example',
    '--sandbox', 'workspace-write',
    '--ignore-user-config',
    '--ignore-rules',
    '--json',
    '--output-last-message', '/run/w/artifacts/final-message-S0.md',
    '-',
  ]);
});

check('codex adapter resumes a known session id', () => {
  const command = getAdapter('codex').buildCommand({
    adapter: 'codex',
    executable: 'codex',
    model: 'm',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S1',
    prompt: 'next',
    session: { id: 'sess-1234567890', started: true },
    reasoningEffort: 'high',
    networkEnabled: false,
  });
  assert.equal(command.args[0], 'exec');
  assert.equal(command.args[1], 'resume');
  assert.ok(command.args.includes('sess-1234567890'));
  assert.ok(command.args.includes('model_reasoning_effort="high"'));
  assert.ok(command.args.includes('sandbox_mode="workspace-write"'));
  assert.ok(command.args.includes('--ignore-user-config'));
  assert.ok(command.args.includes('--ignore-rules'));
  assert.ok(command.args.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(command.args.includes('approval_policy="never"'));
  assert.ok(!command.args.includes('--ask-for-approval'));
  assert.ok(!command.args.includes('--ephemeral'));
  // resume 子命令不接受 --sandbox flag，必须通过 config 延续 workspace-write。
  assert.ok(!command.args.includes('--sandbox'));
});

check('kimi adapter uses prompt-mode auto semantics, resumes later stages, and keeps skills isolated', () => {
  const adapter = getAdapter('kimi');
  const fresh = adapter.buildCommand({
    adapter: 'kimi',
    executable: '/usr/local/bin/kimi',
    model: 'k1',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S0',
    prompt: 'go',
    session: { id: null, started: false },
    emptySkillsDir: '/run/empty-skills',
  });
  assert.equal(fresh.args[0], '--model');
  assert.ok(fresh.args.includes('--prompt'));
  assert.ok(!fresh.args.includes('--auto'));
  assert.ok(!fresh.args.includes('--yolo'));
  assert.ok(fresh.args.includes('--skills-dir'));
  assert.equal(fresh.args[fresh.args.indexOf('--skills-dir') + 1], '/run/empty-skills');
  assert.ok(!fresh.args.includes('--continue'));

  const cont = adapter.buildCommand({
    adapter: 'kimi',
    executable: '/usr/local/bin/kimi',
    model: 'k1',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S1',
    prompt: 'more',
    session: { id: null, started: true },
    emptySkillsDir: '/run/empty-skills',
  });
  assert.equal(cont.args[0], '--continue');
});

check('claude adapter emits session-id on fresh runs and --resume on subsequent runs', () => {
  const adapter = getAdapter('claude');
  const fresh = adapter.buildCommand({
    adapter: 'claude',
    executable: 'claude',
    model: 'sonnet',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S0',
    prompt: 'go',
    session: { id: 'abc-123', started: false },
    maxCostUsd: 1.5,
    allowedTools: ['shell', 'file_read', 'file_write', 'public_web'],
  });
  assert.ok(fresh.args.includes('--session-id'));
  assert.equal(fresh.args[fresh.args.indexOf('--session-id') + 1], 'abc-123');
  assert.equal(fresh.args[fresh.args.indexOf('--max-budget-usd') + 1], '1.5');
  assert.ok(fresh.args.includes('--safe-mode'));
  assert.ok(!fresh.args.includes('--bare'));
  assert.ok(!fresh.args.includes('--no-session-persistence'));
  assert.ok(fresh.args.includes('--strict-mcp-config'));
  assert.ok(fresh.args.includes('--no-chrome'));
  assert.equal(fresh.args[fresh.args.indexOf('--permission-mode') + 1], 'auto');
  assert.ok(fresh.args.includes('--verbose'));
  assert.equal(
    fresh.args[fresh.args.indexOf('--tools') + 1],
    'Bash,Read,Glob,Grep,Edit,Write,WebFetch,WebSearch',
  );

  const resumed = adapter.buildCommand({
    adapter: 'claude',
    executable: 'claude',
    model: 'sonnet',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S1',
    prompt: 'more',
    session: { id: 'abc-123', started: true },
    maxCostUsd: null,
    allowedTools: ['shell', 'file_read', 'file_write'],
  });
  assert.equal(resumed.args[resumed.args.indexOf('--resume') + 1], 'abc-123');
  assert.ok(!resumed.args.includes('--max-budget-usd'));
});

check('claude adapter maps reasoning effort to --effort and omits it when unset', () => {
  const adapter = getAdapter('claude');
  const base = {
    adapter: 'claude',
    executable: 'claude',
    model: 'glm-5.3',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S0',
    prompt: 'go',
    session: { id: 'abc-123', started: false },
    maxCostUsd: 2,
    allowedTools: ['shell', 'file_read', 'file_write'],
  };
  const withEffort = adapter.buildCommand({ ...base, reasoningEffort: 'high' });
  assert.equal(withEffort.args[withEffort.args.indexOf('--effort') + 1], 'high');
  const withoutEffort = adapter.buildCommand({ ...base, reasoningEffort: null });
  assert.ok(!withoutEffort.args.includes('--effort'));
});

check('pi adapter runs non-interactively with explicit provider and resumes its isolated working-directory session', () => {
  const adapter = getAdapter('pi');
  const fresh = adapter.buildCommand({
    adapter: 'pi',
    executable: 'pi',
    model: 'deepseek-chat',
    modelProvider: 'deepseek',
    workspace: '/run/w',
    outputDir: '/run/w/artifacts',
    stageId: 'S0',
    prompt: 'go',
    session: { id: null, started: false },
  });
  assert.equal(fresh.executable, 'pi');
  assert.equal(fresh.stdin, null);
  assert.equal(fresh.format, 'text');
  assert.deepEqual(fresh.args, [
    '--mode', 'print',
    '--approve',
    '--no-context-files',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--session-dir', '/run/w/.pi-sessions',
    '--tools', 'read,bash,edit,write,grep,find,ls',
    '--provider', 'deepseek',
    '--model', 'deepseek-chat',
    'go',
  ]);

  const resumed = adapter.buildCommand({
    ...{
      adapter: 'pi', executable: 'pi', model: 'deepseek-chat', modelProvider: 'deepseek',
      workspace: '/run/w', outputDir: '/run/w/artifacts', stageId: 'S1', prompt: 'continue',
    },
    session: { id: 'pi-session-1234567890', started: true },
  });
  assert.ok(resumed.args.includes('--continue'));
  assert.ok(!resumed.args.includes('--session'));
});

check('parseSemverVersion extracts the first semver-like substring', () => {
  assert.equal(parseSemverVersion('codex-cli 0.144.6'), '0.144.6');
  assert.equal(parseSemverVersion('2.1.177\n'), '2.1.177');
  assert.equal(parseSemverVersion('0.27.0'), '0.27.0');
  assert.equal(parseSemverVersion('no version here'), null);
  assert.equal(parseSemverVersion(null), null);
});

check('adapter.parseVersion delegates to parseSemverVersion', () => {
  for (const adapter of listAdapters()) {
    if (typeof adapter.parseVersion !== 'function') continue; // semi-auto has no CLI
    assert.equal(adapter.parseVersion('foo 1.2.3 bar'), '1.2.3', `${adapter.id} parseVersion`);
    assert.equal(adapter.parseVersion('garbage'), null);
  }
});

check('listAdapters returns the four CLI engines plus semi-auto with stable ids', () => {
  const ids = listAdapters().map(a => a.id);
  assert.ok(ids.includes('codex'));
  assert.ok(ids.includes('kimi'));
  assert.ok(ids.includes('claude'));
  assert.ok(ids.includes('pi'));
  assert.ok(ids.includes('semi-auto'));
  assert.equal(getAdapter('codex').session_continuity, 'native');
  assert.equal(getAdapter('pi').session_continuity, 'native-working-directory');
  assert.equal(getAdapter('semi-auto').session_continuity, 'manual-checkpoint');
});

check('getAdapter throws on unknown engine', () => {
  assert.throws(() => getAdapter('nope'), /Unsupported engine/);
});

check('redactCommand replaces the prompt with <PROMPT> and never leaks stdin verbatim', () => {
  const prompt = 'a'.repeat(80);
  const command = {
    executable: 'codex',
    args: ['exec', '--prompt', prompt, 'tail'],
    stdin: prompt,
    format: 'jsonl',
  };
  const redacted = redactCommand(command, { prompt });
  assert.ok(!redacted.args.includes(prompt));
  assert.ok(redacted.args.includes('<PROMPT>'));
  assert.equal(redacted.stdin, '<PROMPT>');
});

/* ------------------------------------------------------------------ */
/* 归一化事件解析                                                       */
/* ------------------------------------------------------------------ */

check('parseLine classifies json / truncated / plain / empty', () => {
  assert.equal(parseLine('{"a":1}').kind, 'json');
  assert.equal(parseLine('{"a":').kind, 'truncated');
  assert.equal(parseLine('not json').kind, 'plain');
  assert.equal(parseLine('').kind, 'empty');
  assert.equal(parseLine('   ').kind, 'empty');
});

check('normalizeStdout parses Codex JSONL into normalized events with stable seq', () => {
  const { events, stats, empty } = normalizeStdout(fixture('codex-stream.jsonl'), {
    runId: 'r1',
    source: 'codex',
    stageId: 'S0',
    ingestedAt: FIXED_TS,
  });
  assert.equal(empty, false);
  assert.equal(stats.json_ok, 6);
  assert.equal(stats.truncated, 0);
  assert.equal(stats.plain, 0);
  assert.equal(events.length, 6);
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].source, 'codex');
  assert.equal(events[0].stage_id, 'S0');
  assert.equal(events[0].ts, FIXED_TS);
  assert.equal(events[0].type, 'session.info');
  assert.equal(events[1].type, 'assistant.message');
  assert.equal(events[2].type, 'tool.started');
  assert.equal(events[3].type, 'tool.ended');
  assert.equal(events[4].type, 'file.changed');
  assert.equal(events[5].type, 'usage.report');
  // 每一行 raw_ref 都指向 stdout.raw 的对应行号
  assert.equal(events[5].raw_ref, 'stdout.raw#L6');
});

check('normalizeStdout parses Claude nested usage / tool_use shapes', () => {
  const { events } = normalizeStdout(fixture('claude-stream.jsonl'), {
    runId: 'r2', source: 'claude', stageId: 'S0', ingestedAt: FIXED_TS,
  });
  const types = events.map(e => e.type);
  assert.ok(types.includes('assistant.message'), types.join(','));
  const resultEvent = events.find(e => e.data?.type === 'result');
  assert.ok(resultEvent, 'expected a result event');
  assert.equal(resultEvent.type, 'usage.report');
});

check('normalizeStdout flags unknown event types from Kimi stream', () => {
  const { stats } = normalizeStdout(fixture('kimi-stream.jsonl'), {
    runId: 'r3', source: 'kimi', stageId: 'S0', ingestedAt: FIXED_TS,
  });
  // 5 lines: 3 known (mapped message.*), 1 known (tool.ended), 1 truly unknown
  assert.equal(stats.json_ok, 5);
  assert.ok(stats.unknown_types.has('experimental.telemetry'), `unexpected unknown set: ${[...stats.unknown_types]}`);
  // known Kimi event aliases should NOT appear in unknown
  assert.ok(!stats.unknown_types.has('assistant.message'));
});

check('normalizeStdout treats truncated JSONL as recovered process.output', () => {
  const { events, stats } = normalizeStdout(fixture('codex-truncated.jsonl'), {
    runId: 'r4', source: 'codex', stageId: 'S0', ingestedAt: FIXED_TS,
  });
  assert.equal(stats.truncated, 1);
  assert.equal(stats.truncated_lines[0].seq, 5);
  const recovered = events[events.length - 1];
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.data.truncated, true);
});

check('normalizeStdout handles mixed plain/JSON text without throwing', () => {
  const { events, stats } = normalizeStdout(fixture('plain-mixed.txt'), {
    runId: 'r5', source: 'codex', stageId: 'S0', ingestedAt: FIXED_TS,
  });
  assert.ok(stats.plain >= 2);
  assert.ok(stats.json_ok >= 2);
  assert.equal(events.length, 4);
  const plain = events.filter(e => e.data?.text && typeof e.data.text === 'string');
  assert.ok(plain.length >= 1);
});

check('normalizeStdout reports empty output deterministically', () => {
  const { events, empty, stats } = normalizeStdout(fixture('empty.txt'), {
    runId: 'r6', source: 'codex', stageId: 'S0', ingestedAt: FIXED_TS,
  });
  assert.equal(empty, true);
  assert.equal(events.length, 0);
  assert.equal(stats.lines, 0);
});

check('normalizeStdout is robust against non-string input', () => {
  const result = normalizeStdout(null, { runId: 'r', source: 'codex' });
  assert.equal(result.empty, true);
  assert.equal(result.events.length, 0);
});

check('findSessionId extracts the first known session/thread id', () => {
  const id = findSessionId(fixture('codex-stream.jsonl'));
  assert.equal(id, 'sess-codex-abcdef0123');
  assert.equal(findSessionId(fixture('empty.txt')), null);
});

check('findSessionId extracts Pi session headers', () => {
  assert.equal(findSessionId('{"type":"session","version":3,"id":"pi-session-1234567890"}\n'), 'pi-session-1234567890');
});

check('KNOWN_EVENT_TYPES covers the RUN_LOG_SPEC event dictionary', () => {
  for (const required of ['stage.started', 'stage.ended', 'process.started', 'process.ended', 'tool.started', 'tool.ended', 'human.review']) {
    assert.ok(KNOWN_EVENT_TYPES.includes(required), `missing ${required}`);
  }
});

/* ------------------------------------------------------------------ */
/* Token / Cost provenance                                              */
/* ------------------------------------------------------------------ */

check('extractUsage reads Codex top-level usage + cost as provider_api', () => {
  const u = extractUsage({ usage: { input_tokens: 100, output_tokens: 20 }, cost_usd: 0.01 });
  assert.equal(u.tokens.input, 100);
  assert.equal(u.tokens.output, 20);
  assert.equal(u.cost_usd, 0.01);
  assert.equal(u.provenance, USAGE_PROVENANCE.PROVIDER_API);
});

check('extractUsage reads Codex cached_input_tokens from turn.completed usage', () => {
  const usage = extractUsage({
    type: 'turn.completed',
    usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 },
  });
  assert.equal(usage.tokens.input, 100);
  assert.equal(usage.tokens.cached, 80);
  assert.equal(usage.tokens.output, 10);
  assert.equal(usage.tokens.total, 110);
});

check('extractUsage reads Claude nested message.usage without forcing cost', () => {
  const u = extractUsage({ message: { usage: { input_tokens: 50, output_tokens: 10 } } });
  assert.equal(u.tokens.input, 50);
  assert.equal(u.cost_usd, null);
  assert.equal(u.provenance, USAGE_PROVENANCE.NATIVE_CLI);
});

check('extractUsage reads provider cost through normalized event envelopes', () => {
  // collectRunUsageEvents passes { type, data } envelopes; a Claude-style
  // terminal event carries cost at data level, not envelope level.
  const envelope = { type: 'usage.report', data: { total_cost_usd: 0.03, usage: { input_tokens: 5 } } };
  const usage = aggregateUsage([envelope]);
  assert.equal(usage.cost_usd, 0.03);
  assert.equal(usage.provenance, USAGE_PROVENANCE.PROVIDER_API);
  assert.equal(usage.input_tokens, 5);
});

check('preferTerminalUsageEvents avoids double-counting cumulative usage', () => {
  // A Claude-style stream: per-message usage plus a terminal cumulative result.
  const stream = [
    { type: 'assistant.message', data: { usage: { input_tokens: 10, output_tokens: 2 } } },
    { type: 'assistant.message', data: { usage: { input_tokens: 25, output_tokens: 5 } } },
    { type: 'usage.report', data: { usage: { input_tokens: 25, output_tokens: 5 } } },
  ];
  const selected = preferTerminalUsageEvents(stream);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].type, 'usage.report');
  const usage = aggregateUsage(selected);
  assert.equal(usage.input_tokens, 25, 'terminal event wins; per-message events must not be summed in');
});

check('preferTerminalUsageEvents falls back to the full stream without terminal events', () => {
  const stream = [
    { type: 'assistant.message', data: { usage: { input_tokens: 10 } } },
    { type: 'assistant.message', data: { usage: { input_tokens: 15 } } },
  ];
  const selected = preferTerminalUsageEvents(stream);
  assert.equal(selected.length, 2);
  assert.equal(aggregateUsage(selected).input_tokens, 25);
});

check('preferTerminalUsageEvents falls back when terminal events carry no usage', () => {
  const stream = [
    { type: 'assistant.message', data: { usage: { input_tokens: 10 } } },
    { type: 'usage.report', data: { text: 'done' } },
  ];
  // The terminal event exists but proves nothing about usage; per-message
  // deltas remain the only evidence, so the full stream is kept.
  const selected = preferTerminalUsageEvents(stream);
  assert.equal(selected.length, 2);
  assert.equal(aggregateUsage(selected).input_tokens, 10);
});

check('extractUsage reads Claude total_cost_usd as provider_api', () => {
  const u = extractUsage({ total_cost_usd: 0.03, usage: { input_tokens: 1 } });
  assert.equal(u.cost_usd, 0.03);
  assert.equal(u.provenance, USAGE_PROVENANCE.PROVIDER_API);
});

check('aggregateUsage sums tokens across events and keeps cost provenance', () => {
  const events = [
    { usage: { input_tokens: 100, output_tokens: 20 }, cost_usd: 0.01 },
    { usage: { input_tokens: 200, output_tokens: 30, cached_tokens: 5 }, cost_usd: 0.02 },
  ];
  const total = aggregateUsage(events);
  assert.equal(total.input_tokens, 300);
  assert.equal(total.output_tokens, 50);
  assert.equal(total.cached_tokens, 5);
  assert.equal(total.total_tokens, 355);
  assert.equal(total.cost_usd, 0.03);
  assert.equal(total.provenance, USAGE_PROVENANCE.PROVIDER_API);
  assert.equal(total.source_events.length, 2);
});

check('aggregateUsage falls back to unavailable when no usage and estimated disabled', () => {
  const events = [{ type: 'assistant.message', message: 'hi' }];
  const total = aggregateUsage(events);
  assert.equal(total.provenance, USAGE_PROVENANCE.UNAVAILABLE);
  assert.equal(total.total_tokens, null);
  assert.ok(total.reason);
  assert.equal(total.source_events.length, 0);
});

check('aggregateUsage honors explicit allowEstimate flag and refuses implicit estimation', () => {
  const total = aggregateUsage([], { allowEstimate: true, estimatedInputTokens: 100, estimatedOutputTokens: 20 });
  assert.equal(total.provenance, USAGE_PROVENANCE.ESTIMATED);
  assert.equal(total.input_tokens, 100);
  assert.equal(total.total_tokens, 120);

  const noEstimate = aggregateUsage([], { estimatedInputTokens: 100 });
  assert.equal(noEstimate.provenance, USAGE_PROVENANCE.UNAVAILABLE);
  assert.equal(noEstimate.total_tokens, null);
});

check('aggregateUsage parses a real fixture stream end to end', () => {
  const { events } = normalizeStdout(fixture('codex-stream.jsonl'), {
    runId: 'r', source: 'codex', stageId: 'S0', ingestedAt: FIXED_TS,
  });
  const total = aggregateUsage(events.map(e => e.data));
  assert.equal(total.input_tokens, 1200);
  assert.equal(total.output_tokens, 430);
  assert.equal(total.cost_usd, 0.00234);
});

check('emptyUsage documents the missing-data reason', () => {
  const u = emptyUsage(USAGE_PROVENANCE.UNAVAILABLE, 'cli never reported');
  assert.equal(u.provenance, USAGE_PROVENANCE.UNAVAILABLE);
  assert.equal(u.total_tokens, null);
  assert.equal(u.reason, 'cli never reported');
});

/* ------------------------------------------------------------------ */
/* Timings                                                              */
/* ------------------------------------------------------------------ */

check('buildStageTiming records wall time, exit and timeout deterministically', () => {
  const timing = buildStageTiming({
    stage_id: 'S0',
    started_at_ms: 1_000,
    ended_at_ms: 1_750,
    first_byte_at_ms: 1_010,
    last_byte_at_ms: 1_745,
    exit_code: 0,
    empty_output: false,
  });
  assert.equal(timing.stage_id, 'S0');
  assert.equal(timing.wall_ms, 750);
  assert.equal(timing.first_byte_ms, 10);
  assert.equal(timing.last_byte_ms, 745);
  assert.equal(timing.stream_ms, 735);
  assert.equal(timing.exit_code, 0);
  assert.equal(timing.timed_out, false);
  assert.equal(timing.status, 'success');
});

check('buildStageTiming marks timeout separately from non-zero exit', () => {
  const timedOut = buildStageTiming({
    stage_id: 'S1',
    started_at_ms: 0,
    ended_at_ms: 60_000,
    exit_code: null,
    signal: 'SIGTERM',
    timed_out: true,
    empty_output: false,
  });
  assert.equal(timedOut.status, 'timeout');
  assert.equal(timedOut.timed_out, true);
  assert.equal(timedOut.signal, 'SIGTERM');
});

check('buildStageTiming marks empty output as error even with exit 0', () => {
  const empty = buildStageTiming({
    stage_id: 'S2',
    started_at_ms: 0,
    ended_at_ms: 100,
    exit_code: 0,
    empty_output: true,
  });
  assert.equal(empty.status, 'error');
  assert.equal(empty.empty_output, true);
});

check('aggregateRunTiming totals stage wall time and counts outcomes', () => {
  const stages = [
    buildStageTiming({ stage_id: 'S0', started_at_ms: 0, ended_at_ms: 100, exit_code: 0, empty_output: false }),
    buildStageTiming({ stage_id: 'S1', started_at_ms: 100, ended_at_ms: 400, exit_code: 0, empty_output: false }),
    buildStageTiming({ stage_id: 'S2', started_at_ms: 400, ended_at_ms: 700, exit_code: 2, empty_output: false }),
    buildStageTiming({ stage_id: 'S3', started_at_ms: 700, ended_at_ms: 1_200, exit_code: null, timed_out: true, empty_output: false }),
  ];
  const run = aggregateRunTiming(stages, { run_started_at_ms: 0, run_ended_at_ms: 1_200 });
  assert.equal(run.stage_count, 4);
  assert.equal(run.success_stage_count, 2);
  assert.equal(run.error_stage_count, 2);
  assert.equal(run.timed_out_stage_count, 1);
  assert.equal(run.wall_ms, 1_200);
});

/* ------------------------------------------------------------------ */
/* Recovery                                                             */
/* ------------------------------------------------------------------ */

check('diagnoseRecovery returns ok for clean codex stream with exit 0', () => {
  const { stats } = normalizeStdout(fixture('codex-stream.jsonl'), { source: 'codex' });
  const recovery = diagnoseRecovery({ stats, exit_code: 0 });
  assert.equal(recovery.status, 'ok');
  assert.deepEqual(recovery.codes, []);
});

check('diagnoseRecovery recovers from truncated JSONL when exit 0', () => {
  const { stats } = normalizeStdout(fixture('codex-truncated.jsonl'), { source: 'codex' });
  const recovery = diagnoseRecovery({ stats, exit_code: 0 });
  assert.equal(recovery.status, 'recovered');
  assert.ok(recovery.codes.includes('truncated_output'));
  assert.ok(recovery.codes.includes('unknown_events'));
});

check('diagnoseRecovery flags non-zero exit as unrecovered and preserves evidence', () => {
  const { stats } = normalizeStdout(fixture('codex-stream.jsonl'), { source: 'codex' });
  const recovery = diagnoseRecovery({ stats, exit_code: 1 });
  assert.equal(recovery.status, 'unrecovered');
  assert.ok(recovery.codes.includes('non_zero_exit'));
  assert.equal(recovery.evidence_preserved, true);
  assert.ok(recovery.root_cause_hint);
  assert.ok(recovery.safe_retry);
  assert.ok(recovery.stop_condition);
});

check('diagnoseRecovery treats empty output as unrecovered', () => {
  const recovery = diagnoseRecovery({ stats: { lines: 0, json_ok: 0, truncated: 0, plain: 0, unknown_types: new Set() }, exit_code: 0, empty_output: true });
  assert.equal(recovery.status, 'unrecovered');
  assert.ok(recovery.codes.includes('empty_output'));
});

check('diagnoseRecovery treats timeout as unrecovered', () => {
  const timing = buildStageTiming({ stage_id: 'S1', started_at_ms: 0, ended_at_ms: 1000, exit_code: null, timed_out: true, signal: 'SIGTERM', empty_output: true });
  const recovery = diagnoseRecovery({ timing });
  assert.equal(recovery.status, 'unrecovered');
  assert.ok(recovery.codes.includes('timeout'));
  assert.ok(recovery.codes.includes('killed'));
});

check('toRecoveryEnvelope returns null for healthy stages', () => {
  assert.equal(toRecoveryEnvelope({ stats: { lines: 1, json_ok: 1, truncated: 0, plain: 0, unknown_types: new Set() }, exit_code: 0 }), null);
});

check('toRecoveryEnvelope exposes CONTROL_PROTOCOL error envelope fields', () => {
  const env = toRecoveryEnvelope({ exit_code: 1, stats: { lines: 1, json_ok: 1, truncated: 0, plain: 0, unknown_types: new Set() } });
  assert.equal(env.recovery_status, 'unrecovered');
  for (const field of ['root_cause_hint', 'safe_retry', 'stop_condition']) {
    assert.ok(typeof env[field] === 'string' && env[field].length > 0, `missing ${field}`);
  }
});

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

const failures = [];
for (const [name, fn] of checks) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.message });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  }
}

const payload = {
  status: failures.length ? 'error' : 'success',
  summary: `${checks.length - failures.length}/${checks.length} runner + telemetry checks passed.`,
  next_actions: failures.length ? failures.map(f => `Fix: ${f.name}`) : [],
  artifacts: ['tests/runners/run.mjs'],
};
if (failures.length) payload.failures = failures;

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
