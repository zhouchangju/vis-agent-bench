import { relative, resolve } from 'node:path';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertRunId(value) {
  if (typeof value !== 'string' || !RUN_ID.test(value) || value === '.' || value === '..') {
    throw new TypeError(
      'run-id must be 1-128 characters using only letters, numbers, dot, underscore, or hyphen.',
    );
  }
  return value;
}

export function containedRunDirectory(root, runId) {
  const safeId = assertRunId(runId);
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, safeId);
  const rel = relative(absoluteRoot, target);
  if (rel === '' || rel.startsWith('..') || rel.includes('/../') || rel.includes('\\..\\')) {
    throw new TypeError(`run-id resolves outside the configured run root: ${runId}`);
  }
  return target;
}
