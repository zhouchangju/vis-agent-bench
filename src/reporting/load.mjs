// Loader that turns on-disk Run directories into report entries.
//
// Each entry is expected to expose:
//   - run        : result.json produced by scripts/bench.mjs
//   - evaluator  : optional evaluator-summary.json
//   - human_review : optional human-review.json conforming to schemas/human-review.schema.json
//   - isolation  : optional isolation.json
//   - browser    : optional browser-evidence.json
//
// The loader is permissive: missing optional files simply produce null
// fields, which the builder surfaces as "unavailable". Path references are
// preserved so the renderer can cite evidence.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${path}: ${error.message}`);
  }
}

function attachPath(value, path) {
  if (value && typeof value === 'object') {
    Object.defineProperty(value, 'path', { value: path, enumerable: false, configurable: true });
  }
  return value;
}

export function loadEntry(runDir, { demo = false, caseMeta } = {}) {
  if (!existsSync(runDir)) {
    throw new Error(`Run directory does not exist: ${runDir}`);
  }
  const run = readJson(join(runDir, 'result.json'));
  if (!run) {
    throw new Error(`Missing result.json in ${runDir}; cannot build report entry.`);
  }
  attachPath(run, join(runDir, 'result.json'));

  const evaluator = readJson(join(runDir, 'evaluator-summary.json'));
  if (evaluator) attachPath(evaluator, join(runDir, 'evaluator-summary.json'));

  const humanReview = readJson(join(runDir, 'human-review.json'));
  if (humanReview) attachPath(humanReview, join(runDir, 'human-review.json'));

  const isolation = readJson(join(runDir, 'isolation.json'));
  if (isolation) attachPath(isolation, join(runDir, 'isolation.json'));

  const browser = readJson(join(runDir, 'browser-evidence.json'));
  if (browser) attachPath(browser, join(runDir, 'browser-evidence.json'));

  const revision = readJson(join(runDir, 'revision.json'));
  if (revision) attachPath(revision, join(runDir, 'revision.json'));

  return {
    run, evaluator, human_review: humanReview, isolation, browser, revision,
    demo, case_meta: caseMeta || null,
  };
}

export function loadBaseline(baselinePath) {
  if (!baselinePath) return null;
  const value = readJson(baselinePath);
  if (!value) throw new Error(`Baseline file is empty or missing: ${baselinePath}`);
  return value;
}
