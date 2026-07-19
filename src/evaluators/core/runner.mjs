// Check execution lifecycle.
//
// The runner is deliberately narrow: it executes checks in declaration
// order, isolates harness crashes from project failures, enforces a
// per-check timeout, and produces structured CheckResults. Scoring lives in
// scoring.mjs; orchestration of multiple rubrics lives in lifecycle.mjs.

import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  attachExecutorEvidence,
  harnessErrorResult,
  normaliseOutcome,
  skippedResult,
} from './check.mjs';
import { STATUS } from './status.mjs';

const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;

// Execute a single check inside an ExecutionContext.
//
// Returns a CheckResult. Never throws: any thrown error becomes an
// `error` status with failure_source='evaluator' so downstream scoring can
// distinguish harness faults from project failures.
export async function runCheck(check, ctx, options = {}) {
  const started = Date.now();
  const executor = await executeAssertion(check, ctx, options).catch(error => ({
    __harness_error: error,
  }));

  if (executor && executor.__harness_error) {
    return withTiming(harnessErrorResult(check, {
      reason: `evaluator threw while executing check "${check.id}"`,
      error: executor.__harness_error,
    }), started);
  }

  // Assertion was skipped before reaching the project command (e.g. missing
  // artifact, dependency not satisfied). Failure source stays 'evaluator'.
  if (executor && executor.__skipped) {
    return withTiming(skippedResult(check, executor.__skipped), started);
  }

  const outcome = await invokeRun(check, ctx, executor, options).catch(error => ({
    __harness_error: error,
  }));

  if (outcome && outcome.__harness_error) {
    return withTiming(harnessErrorResult(check, {
      reason: `check "${check.id}" run() threw: ${outcome.__harness_error.message}`,
      error: outcome.__harness_error,
    }), started);
  }

  const result = attachExecutorEvidence(
    normaliseOutcome(check, outcome),
    {
      ...executor,
      duration_ms: Date.now() - started,
    },
  );
  return withTiming(result, started);
}

function withTiming(result, startedAt) {
  return { ...result, duration_ms: result.duration_ms || (Date.now() - startedAt) };
}

async function invokeRun(check, ctx, executor, options) {
  if (typeof options.beforeRun === 'function') {
    await options.beforeRun(check, ctx);
  }
  const outcome = await Promise.resolve(check.run(ctx, executor));
  if (typeof options.afterRun === 'function') {
    await options.afterRun(check, ctx, outcome);
  }
  return outcome;
}

// Resolve the executor evidence for a check. The default executor supports
// two assertion styles:
//
//   1. `command` mode: the check describes a CLI invocation; the runner
//      spawns it, captures stdout/stderr, and returns the exit metadata.
//   2. `inline` mode: the check has no command and runs entirely inside its
//      run() function (the common case for in-process assertions).
//
// The runner does NOT know anything about the assertion semantics — it just
// gathers evidence so the result can be replayed later.
async function executeAssertion(check, ctx, options) {
  if (ctx?.abortSignal?.aborted) {
    return { __skipped: 'run was aborted before this check started' };
  }

  const missingArtifact = (check.requires_artifacts || []).find(id => !ctx?.hasArtifact(id));
  if (missingArtifact) {
    return { __skipped: `required artifact "${missingArtifact}" is not present` };
  }

  // Dependent checks are skipped if any dependency did not pass.
  const deps = check.depends_on || [];
  if (deps.length && options.dependencyStatus) {
    for (const depId of deps) {
      const dep = options.dependencyStatus.get(depId);
      if (!dep || dep === STATUS.SKIPPED || dep === STATUS.ERROR || dep === STATUS.FAIL) {
        return { __skipped: `dependency "${depId}" did not pass (status: ${dep || 'unknown'})` };
      }
    }
  }

  const command = typeof check.command === 'object' && check.command
    ? check.command
    : (typeof options.commandFor === 'function' ? options.commandFor(check, ctx) : null);

  if (!command) {
    return { command: null, kind: 'inline' };
  }

  const logsDir = options.logsDir || ctx?.workspace || process.cwd();
  return await runCommandEvidence({
    command,
    logsDir,
    timeoutMs: check.timeout_ms,
    cwd: options.cwd || ctx?.workspace || null,
    env: mergeEnv(ctx?.env, command.env, options.env),
    stdin: command.stdin ?? null,
  });
}

// Merge env layers for a spawned assertion. We start from process.env so
// PATH and other OS-level lookup variables are preserved — case evaluators
// should not need to reconstruct PATH just to spawn `node` or `tsc`. Layers
// passed later override earlier ones.
function mergeEnv(...layers) {
  const merged = { ...process.env };
  for (const layer of layers) {
    if (layer && typeof layer === 'object') Object.assign(merged, layer);
  }
  return merged;
}

// Spawn the assertion command and return captured evidence. This is a thin
// wrapper — it does not interpret exit codes. The check's run() is the only
// place allowed to decide pass/fail.
export function runCommandEvidence({
  command,
  logsDir,
  timeoutMs,
  cwd = null,
  env = process.env,
  stdin = null,
}) {
  return new Promise((resolve) => {
    const slug = String(command.id || command.label || 'check').replace(/[^\w.-]+/g, '_');
    const stdoutPath = join(logsDir, `${slug}.stdout.log`);
    const stderrPath = join(logsDir, `${slug}.stderr.log`);
    const stdout = createWriteStream(stdoutPath);
    const stderr = createWriteStream(stderrPath);
    const stdoutFinished = new Promise(done => stdout.once('finish', done));
    const started = Date.now();

    const child = spawn(command.executable, command.args || [], {
      cwd: cwd || undefined,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    if (stdin != null) child.stdin.end(stdin);
    else child.stdin.end();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      stdout.end();
      stderr.end();
      resolve({
        command: { executable: command.executable, args: command.args || [] },
        exit_code: null,
        signal: null,
        timed_out: false,
        spawn_error: error.message,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        duration_ms: Date.now() - started,
        kind: 'command',
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      stderr.end();
      stdout.end();
      stdoutFinished.then(() => {
        resolve({
          command: { executable: command.executable, args: command.args || [] },
          exit_code: code,
          signal,
          timed_out: timedOut,
          stdout_path: stdoutPath,
          stderr_path: stderrPath,
          duration_ms: Date.now() - started,
          kind: 'command',
        });
      });
    });
  });
}

// Convenience helper: write a small artifact JSON to the logs dir. Used by
// case evaluators to persist intermediate state (DOM snapshots, samples,
// timing tables) without re-running their checks.
export function writeArtifact(logsDir, name, payload) {
  const path = join(logsDir, name);
  writeFileSync(path, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
  return path;
}
