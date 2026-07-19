import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadCheckpoints(runDir) {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) return { schema_version: 1, completed: {}, failures: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveCheckpoints(runDir, state) {
  const path = checkpointPath(runDir);
  mkdirSync(join(runDir, 'logs', 'checkpoints'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  return path;
}

export async function runCheckpoint({ runDir, id, state, execute }) {
  if (state.completed[id]) {
    return { ...state.completed[id].result, checkpoint: 'reused' };
  }
  const startedAt = new Date().toISOString();
  try {
    const result = await execute();
    if (!result || !['success', 'warning'].includes(result.status)) {
      throw Object.assign(new Error(result?.summary || `Checkpoint ${id} failed.`), { result });
    }
    const completedAt = new Date().toISOString();
    state.completed[id] = { started_at: startedAt, completed_at: completedAt, result };
    writeFileSync(
      join(runDir, 'logs', 'checkpoints', `${id}.json`),
      `${JSON.stringify(state.completed[id], null, 2)}\n`,
    );
    saveCheckpoints(runDir, state);
    return { ...result, checkpoint: 'executed' };
  } catch (error) {
    const failure = {
      id,
      failed_at: new Date().toISOString(),
      summary: error.message,
      result: error.result || null,
    };
    state.failures.push(failure);
    saveCheckpoints(runDir, state);
    throw error;
  }
}

function checkpointPath(runDir) {
  return join(runDir, 'logs', 'checkpoints.json');
}
