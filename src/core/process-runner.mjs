import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function detectExecutable(executable, versionArgs = ['--version']) {
  const started = Date.now();
  const result = spawnSync(executable, versionArgs, {
    encoding: 'utf8',
    timeout: 10_000,
    shell: false,
  });
  return {
    available: !result.error && result.status === 0,
    executable,
    version: (result.stdout || result.stderr || '').trim().split('\n')[0] || null,
    exit_code: result.status,
    duration_ms: Date.now() - started,
    error: result.error?.message || null,
  };
}

function normalizeLines(source, runId, engine, target, stageId = null) {
  const lines = readFileSync(source, 'utf8').split(/\r?\n/).filter(Boolean);
  const events = lines.map((line, index) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      data = { text: line };
    }
    return {
      ts: new Date().toISOString(),
      run_id: runId,
      stage_id: stageId,
      seq: index + 1,
      source: engine,
      type: typeof data.type === 'string' ? data.type : 'process.output',
      status: 'success',
      summary: typeof data.text === 'string' ? data.text.slice(0, 240) : 'CLI event',
      data,
      raw_ref: `stdout.raw#L${index + 1}`,
    };
  });
  writeFileSync(target, events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
}

export function runCommand({ runId, engine, command, cwd, logsDir, timeoutMs, env, stageId = null }) {
  return new Promise((resolve) => {
    const stdoutPath = join(logsDir, 'stdout.raw');
    const stderrPath = join(logsDir, 'stderr.raw');
    const stdout = createWriteStream(stdoutPath);
    const stderr = createWriteStream(stderrPath);
    const stdoutFinished = new Promise(done => stdout.once('finish', done));
    const started = Date.now();

    const child = spawn(command.executable, command.args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    if (command.stdin != null) child.stdin.end(command.stdin);
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
        status: 'error',
        exit_code: null,
        signal: null,
        timed_out: timedOut,
        duration_ms: Date.now() - started,
        error: error.message,
        stdoutPath,
        stderrPath,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      stderr.end();
      stdout.end();
      stdoutFinished.then(() => {
        const normalized = join(logsDir, 'normalized-events.jsonl');
        normalizeLines(stdoutPath, runId, engine, normalized, stageId);
        resolve({
          status: code === 0 && !timedOut ? 'success' : 'error',
          exit_code: code,
          signal,
          timed_out: timedOut,
          duration_ms: Date.now() - started,
          error: null,
          stdoutPath,
          stderrPath,
          normalized,
        });
      });
    });
  });
}
