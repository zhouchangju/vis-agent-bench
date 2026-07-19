#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runsRoot = join(projectRoot, '.local', 'runs');

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2).replaceAll('-', '_');
    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function listRuns() {
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(runsRoot, entry.name))
    .sort();
}

function resolveRunDir(value) {
  if (!value) return listRuns().at(-1) || null;
  const direct = resolve(value);
  if (existsSync(direct)) return direct;
  const byId = join(runsRoot, value);
  return existsSync(byId) ? byId : null;
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function relativeAge(timeMs) {
  if (!timeMs) return '尚无日志';
  const seconds = Math.max(0, Math.round((Date.now() - timeMs) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分钟前`;
}

function snapshot(runDir) {
  const spec = readJson(join(runDir, 'run-spec.json'));
  const result = readJson(join(runDir, 'result.json'));
  if (!spec) throw new Error(`无法读取 RunSpec：${join(runDir, 'run-spec.json')}`);
  const completedStageIds = spec.scenario?.completed_stages?.length
    ? spec.scenario.completed_stages
    : (result?.stages || [])
      .filter(stage => stage.status === 'success')
      .map(stage => stage.stage_id);
  const stages = [];
  for (const stageId of spec.scenario?.stage_ids || []) {
    const stdout = join(runDir, 'logs', 'stages', stageId, 'stdout.raw');
    const stderr = join(runDir, 'logs', 'stages', stageId, 'stderr.raw');
    const stdoutStat = existsSync(stdout) ? statSync(stdout) : null;
    const stderrStat = existsSync(stderr) ? statSync(stderr) : null;
    stages.push({
      id: stageId,
      status: completedStageIds.includes(stageId)
        ? 'completed'
        : (spec.scenario?.current_stage === stageId ? 'running' : 'pending'),
      stdout_bytes: stdoutStat?.size || 0,
      stderr_bytes: stderrStat?.size || 0,
      updated_at_ms: Math.max(stdoutStat?.mtimeMs || 0, stderrStat?.mtimeMs || 0),
    });
  }
  return {
    run_id: spec.run_id,
    run_dir: runDir,
    case_id: spec.case_id,
    model: spec.engine?.model || spec.engine?.configured_model,
    engine: spec.engine?.adapter,
    status: result?.status || spec.status,
    current_stage: spec.scenario?.current_stage,
    completed: completedStageIds.length,
    total: spec.scenario?.stage_ids?.length || 0,
    workspace: join(runDir, 'workspace'),
    stages,
    result_exists: Boolean(result),
  };
}

function render(data) {
  const current = data.stages.find(stage => stage.id === data.current_stage);
  const lines = [
    `[VAB ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${data.run_id}`,
    `  状态：${data.status}；Case：${data.case_id}；引擎/模型：${data.engine}/${data.model}`,
    `  阶段：${data.current_stage || '尚未开始'}（已完成 ${data.completed}/${data.total}）`,
  ];
  if (current) {
    lines.push(
      `  当前日志：stdout ${formatBytes(current.stdout_bytes)}；stderr ${formatBytes(current.stderr_bytes)}；最后更新 ${relativeAge(current.updated_at_ms)}`,
      `  日志文件：${join(data.run_dir, 'logs', 'stages', current.id, 'stdout.raw')}`,
    );
  }
  lines.push(
    `  独立工作区：${data.workspace}`,
    `  Run 目录：${data.run_dir}`,
  );
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    const runs = listRuns().slice(-20).reverse();
    process.stdout.write(`${runs.map(path => basename(path)).join('\n')}\n`);
    return;
  }
  const runDir = resolveRunDir(args.run);
  if (!runDir) throw new Error('没有找到 Run；请使用 --run <run-id|目录>，或先执行一次评测。');
  if (!args.watch) {
    process.stdout.write(`${render(snapshot(runDir))}\n`);
    return;
  }

  let previous = '';
  let heartbeat = 0;
  let timer = null;
  const tick = () => {
    const data = snapshot(runDir);
    const signature = JSON.stringify({
      status: data.status,
      current_stage: data.current_stage,
      completed: data.completed,
      stages: data.stages.map(stage => [stage.id, stage.stdout_bytes, stage.stderr_bytes]),
    });
    heartbeat += 1;
    if (signature !== previous || heartbeat >= 10) {
      process.stdout.write(`${render(data)}\n\n`);
      previous = signature;
      heartbeat = 0;
    }
    if (data.result_exists && !['prepared', 'running'].includes(data.status)) {
      if (timer) clearInterval(timer);
    }
  };
  const intervalMs = Math.max(1000, Number(args.interval_seconds || 3) * 1000);
  timer = setInterval(tick, intervalMs);
  tick();
}

try {
  main();
} catch (error) {
  process.stderr.write(`[VAB] ${error.message}\n`);
  process.exitCode = 1;
}
