import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Baseline gate.
 *
 * Proves that a sanitised starting workspace actually builds, type-checks and
 * tests. The gate never invents commands: it only runs what the Case declares,
 * because the whole point of a fixture is "give the agent a clean, working
 * scaffold" — if we added hidden commands we would be moving the goalposts.
 *
 * The gate is the *last* thing that runs before a manifest is published. If
 * any required step fails, the manifest is rejected and no half-built fixture
 * is exported.
 */

export const STEP_TYPES = ['build', 'typecheck', 'test', 'lint'];

/**
 * @typedef {Object} BaselineStepDescriptor
 * @property {('build'|'typecheck'|'test'|'lint')} type
 * @property {Array<string>} command            argv array, [executable, ...args]
 * @property {boolean} [required=true]          required steps gate publication; optional steps only report.
 * @property {number} [timeout_ms=120000]
 */

/**
 * @typedef {Object} BaselineStepResult
 * @property {string} name                      `${type}`
 * @property {('build'|'typecheck'|'test'|'lint')} type
 * @property {boolean} required
 * @property {Array<string>} command            sanitised command actually executed
 * @property {('passed'|'failed'|'skipped'|'missing')} status
 * @property {number|null} exit_code
 * @property {number} duration_ms
 * @property {string|null} log_path             relative to logs_root
 */

/**
 * Resolve a Case-declared baseline fragment into a list of step descriptors.
 *
 * Accepted shapes (so Case YAML stays readable):
 *
 *   baseline:
 *     build:
 *       command: ['npm', 'run', 'build']
 *       required: true
 *       timeout_ms: 180000
 *     typecheck: ['npm', 'run', 'typecheck']
 *     test: ['npm', 'test']
 *     lint:
 *       command: ['npm', 'run', 'lint']
 *       required: false
 *
 * Or, equivalently:
 *
 *   baseline:
 *     - { type: build, command: ['npm', 'run', 'build'] }
 *
 * @param {Object} [declared]
 * @returns {Array<BaselineStepDescriptor>}
 */
export function resolveBaselineSteps(declared = {}) {
  const steps = [];

  if (Array.isArray(declared)) {
    for (const entry of declared) steps.push(normaliseStepEntry(entry));
    return steps.filter(Boolean);
  }

  if (declared && typeof declared === 'object') {
    for (const type of STEP_TYPES) {
      const value = declared[type];
      if (value == null) continue;
      if (Array.isArray(value)) {
        steps.push(normaliseStepEntry({ type, command: value }));
      } else if (typeof value === 'object') {
        steps.push(normaliseStepEntry({ type, ...value }));
      }
    }
    if (Array.isArray(declared.steps)) {
      for (const entry of declared.steps) steps.push(normaliseStepEntry(entry));
    }
  }

  return steps.filter(Boolean);
}

function normaliseStepEntry(entry) {
  if (entry == null) return null;
  const type = entry.type || entry.name;
  if (!STEP_TYPES.includes(type)) return null;
  const command = entry.command || entry.cmd || entry.argv;
  if (!Array.isArray(command) || command.length === 0) {
    // A declared step with no command means "this Case has nothing of this kind";
    // treat it as a skipped placeholder rather than a hard error.
    return { type, command: [], required: false, timeout_ms: entry.timeout_ms ?? 60_000, skipped: true };
  }
  return {
    type,
    command: command.map(String),
    required: entry.required !== false,
    timeout_ms: entry.timeout_ms ?? entry.timeout_ms_ ?? 120_000,
  };
}

function sanitiseCommand(command) {
  // Strip the prompt body from any arg so logs never echo model-visible input
  // even if a future Case reuses this for staging. Args here are fixed by the
  // Case author and reviewed by the operator, so we keep them verbatim.
  return command.map(String);
}

/**
 * Run baseline steps sequentially against a workspace.
 *
 * @param {Object} params
 * @param {string} params.workspaceRoot
 * @param {Array<BaselineStepDescriptor>} params.steps
 * @param {string} params.logsRoot
 * @param {Object} [params.env]               environment override (defaults to process.env)
 * @param {AbortSignal} [params.signal]
 * @returns {{ status: 'passed'|'failed'|'skipped', steps: Array<BaselineStepResult>, started_at: string, ended_at: string, duration_ms: number }}
 */
export function runBaselineGate({ workspaceRoot, steps, logsRoot, env, signal }) {
  mkdirSync(logsRoot, { recursive: true });
  const startedAt = new Date();
  const startedMs = Date.now();
  const runEnv = env ?? { ...process.env, CI: '1' };
  const stepResults = [];
  let overall = 'passed';

  for (const step of steps) {
    if (signal?.aborted) {
      stepResults.push(makeSkipped(step, 'aborted'));
      overall = overall === 'passed' ? 'skipped' : overall;
      continue;
    }
    if (step.skipped || step.command.length === 0) {
      const result = makeSkipped(step);
      stepResults.push(result);
      writeStepLog(logsRoot, step, { status: 'skipped', stdout: '', stderr: `Step ${step.type} declared but skipped (no command).\n`, exit_code: null });
      continue;
    }

    const [executable, ...args] = sanitiseCommand(step.command);
    const started = Date.now();
    const proc = spawnSync(executable, args, {
      cwd: workspaceRoot,
      env: runEnv,
      encoding: 'utf8',
      shell: false,
      timeout: step.timeout_ms,
    });
    const durationMs = Date.now() - started;
    const exitCode = proc.status ?? null;
    // Any non-null signal (including an external SIGTERM) means the step did
    // not run to completion; the timeout path additionally sets error=ETIMEDOUT.
    // Fail closed: never record a killed step as passed.
    const failed = proc.error != null || proc.signal != null || exitCode !== 0;
    const status = failed ? 'failed' : 'passed';

    const logPath = writeStepLog(logsRoot, step, {
      status,
      stdout: proc.stdout ?? '',
      stderr: (proc.stderr ?? '') + (proc.error ? `\nspawn_error: ${proc.error.message}\n` : ''),
      exit_code: exitCode,
      signal: proc.signal ?? null,
      timed_out: proc.error?.code === 'ETIMEDOUT' || !!proc.signal,
      duration_ms: durationMs,
      command: sanitiseCommand(step.command),
    });

    stepResults.push({
      name: step.type,
      type: step.type,
      required: step.required !== false,
      command: sanitiseCommand(step.command),
      status,
      exit_code: exitCode,
      duration_ms: durationMs,
      log_path: logPath,
    });

    if (failed && step.required !== false) {
      overall = 'failed';
      // Stop the gate at the first required failure: a half-passing baseline is
      // still a failing baseline, and continuing would only mask the first real
      // regression behind a cascade.
      break;
    }
    // Optional (required=false) step failures are reported on the step but do
    // not flip the overall gate status: the fixture is still publishable, the
    // manifest just surfaces the non-blocking failure for human review.
  }

  const endedAt = new Date();
  // If no steps ran at all, the gate is neither passed nor failed.
  if (steps.length === 0) overall = 'skipped';

  return {
    status: overall,
    steps: stepResults,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: Date.now() - startedMs,
  };
}

function makeSkipped(step, reason) {
  return {
    name: step.type,
    type: step.type,
    required: step.required !== false,
    command: [],
    status: 'skipped',
    exit_code: null,
    duration_ms: 0,
    log_path: null,
    ...(reason ? { reason } : {}),
  };
}

function writeStepLog(logsRoot, step, payload) {
  const file = `${step.type}.log.json`;
  const target = join(logsRoot, file);
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}
