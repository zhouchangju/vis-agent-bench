import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 日志是可回溯证据，不应成为单个 Agent 进程耗尽宿主机磁盘/内存的入口。
// 16 MiB 足够保留普通 CLI 的完整阶段输出；超过则保留前缀与明确截断证据，并判定该阶段失败。
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

/**
 * 构建 Baseline 完整性门禁使用的隔离环境：HOME 与 npm cache 指向 rootDir 下的
 * 专属目录，使门禁结果只依赖 workspace 内容与受控变量，不受操作员本机
 * npm 配置或 HOME 状态影响。仅透传运行命令所需的最小变量集合。
 */
export function validationEnvironment(rootDir, extra = {}) {
  const isolatedHome = join(rootDir, '.validation-home');
  const npmCache = join(rootDir, '.validation-npm-cache');
  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(npmCache, { recursive: true });
  const env = {};
  for (const key of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'NO_COLOR', 'CI']) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: isolatedHome,
    npm_config_cache: npmCache,
    ...extra,
  };
}

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
    const stderrFinished = new Promise(done => stderr.once('finish', done));
    const started = Date.now();

    const child = spawn(command.executable, command.args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const output = {
      stdout_bytes: 0,
      stderr_bytes: 0,
      stdout_discarded_bytes: 0,
      stderr_discarded_bytes: 0,
    };
    const capture = (stream, sink, keptKey, discardedKey) => {
      stream.on('data', chunk => {
        const remaining = Math.max(0, MAX_CAPTURE_BYTES - output[keptKey]);
        if (remaining > 0) {
          const kept = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
          output[keptKey] += kept.length;
          sink.write(kept);
        }
        if (chunk.length > remaining) output[discardedKey] += chunk.length - remaining;
      });
    };
    capture(child.stdout, stdout, 'stdout_bytes', 'stdout_discarded_bytes');
    capture(child.stderr, stderr, 'stderr_bytes', 'stderr_discarded_bytes');
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
      if (output.stdout_discarded_bytes > 0) {
        stdout.write(`\n[VAB] stdout exceeded ${MAX_CAPTURE_BYTES} bytes; ${output.stdout_discarded_bytes} bytes were discarded.\n`);
      }
      if (output.stderr_discarded_bytes > 0) {
        stderr.write(`\n[VAB] stderr exceeded ${MAX_CAPTURE_BYTES} bytes; ${output.stderr_discarded_bytes} bytes were discarded.\n`);
      }
      stderr.end();
      stdout.end();
      Promise.all([stdoutFinished, stderrFinished]).then(() => {
        const normalized = join(logsDir, 'normalized-events.jsonl');
        normalizeLines(stdoutPath, runId, engine, normalized, stageId);
        const outputTruncated = output.stdout_discarded_bytes > 0 || output.stderr_discarded_bytes > 0;
        resolve({
          status: code === 0 && !timedOut && !outputTruncated ? 'success' : 'error',
          exit_code: code,
          signal,
          timed_out: timedOut,
          duration_ms: Date.now() - started,
          error: outputTruncated
            ? `CLI output exceeded the ${MAX_CAPTURE_BYTES}-byte capture limit; retained prefix and truncation marker.`
            : null,
          stdoutPath,
          stderrPath,
          normalized,
          output,
        });
      });
    });
  });
}
