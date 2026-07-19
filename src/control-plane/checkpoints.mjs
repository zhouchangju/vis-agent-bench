import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadCheckpoints(runDir, specSha256) {
  const path = checkpointPath(runDir);
  if (!existsSync(path)) {
    return { schema_version: 1, spec_sha256: specSha256, completed: {}, failures: [] };
  }
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (!specSha256 || state.spec_sha256 !== specSha256) {
    throw new Error('Checkpoint RunSpec digest mismatch; use a new run-id.');
  }
  return state;
}

export function saveCheckpoints(runDir, state) {
  const path = checkpointPath(runDir);
  mkdirSync(join(runDir, 'logs', 'checkpoints'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  return path;
}

export async function runCheckpoint({ runDir, id, state, execute }) {
  if (state.completed[id]) {
    verifyArtifactDigests(state.completed[id].artifact_digests || {});
    return { ...state.completed[id].result, checkpoint: 'reused' };
  }
  const startedAt = new Date().toISOString();
  try {
    const result = await execute();
    if (!result || !['success', 'warning'].includes(result.status)) {
      throw Object.assign(new Error(result?.summary || `Checkpoint ${id} failed.`), { result });
    }
    const completedAt = new Date().toISOString();
    state.completed[id] = {
      started_at: startedAt,
      completed_at: completedAt,
      result,
      artifact_digests: artifactDigests(result.artifacts),
    };
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

function artifactDigests(paths = []) {
  const values = {};
  for (const path of paths || []) {
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    values[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return values;
}

function verifyArtifactDigests(values) {
  for (const [path, expected] of Object.entries(values)) {
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Checkpoint artifact disappeared: ${path}`);
    }
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (actual !== expected) throw new Error(`Checkpoint artifact digest changed: ${path}`);
  }
}

function checkpointPath(runDir) {
  return join(runDir, 'logs', 'checkpoints.json');
}
