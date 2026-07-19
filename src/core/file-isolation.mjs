import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import {
  buildRuleSet,
  mergeLegacyRules,
  scanWorkspace,
  resolveLegacyRules,
} from '../fixtures/leakage.mjs';
import {
  resolveExclusionConfig,
  compileExclusionFilter,
} from '../fixtures/exclusion.mjs';

/**
 * File-level isolation for development runs.
 *
 * This module is the Runner-facing facade over the Fixture Builder primitives
 * in `src/fixtures/`. It keeps the small surface that `scripts/bench.mjs` has
 * been calling since VAB-T00 (copy / list / scan / run layout) while delegating
 * the actual scanning logic to the shared, tested rule engine.
 *
 * Reminder (see docs/architecture/ISOLATION_AND_ANTI_CHEATING.md): file-level
 * isolation only proves that the platform did not *deliver* answers into the
 * workspace. It cannot stop a process running as the user from reading other
 * host directories. Such runs are `leaderboard_eligible=false`.
 */

const excludedNames = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
]);

function shouldCopy(source) {
  return !excludedNames.has(basename(source));
}

export function copyWorkspaceSource(source, target) {
  if (!existsSync(source)) throw new Error(`Workspace source does not exist: ${source}`);
  cpSync(source, target, {
    recursive: true,
    filter: shouldCopy,
    preserveTimestamps: true,
  });
}

/**
 * Copy a source tree into a target while applying a Case-declared exclusion
 * configuration. Used by the Fixture Builder directly; exposed here so the
 * Runner can perform an ad-hoc sanitised copy when a Case has no full plan.
 */
export function copyWorkspaceWithExclusion(source, target, exclusionConfig) {
  if (!existsSync(source)) throw new Error(`Workspace source does not exist: ${source}`);
  const exclude = exclusionConfig
    ? compileExclusionFilter(resolveExclusionConfig(exclusionConfig))
    : (_rel, _isDir) => false;
  cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    filter: (src) => {
      if (src === source) return true;
      if (excludedNames.has(basename(src))) return false;
      const rel = relative(source, src);
      return !exclude(rel, false);
    },
  });
}

export function listFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const stat = statSync(path);
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        files.push({ path: relative(root, path), bytes: stat.size, sha256: hash });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Scan a workspace for answer leakage.
 *
 * Returns the legacy-shaped findings (`{ file, rule, source }`) by default so
 * `scripts/bench.mjs` keeps working unchanged. Pass `{ detailed: true }` to
 * get the full VAB-T02 finding shape (rule_id, recovery hint, line, snippet).
 *
 * @param {string} caseId
 * @param {string} workspace
 * @param {{ declared?: object, detailed?: boolean }} [options]
 */
export function scanForAnswerLeakage(caseId, workspace, options = {}) {
  const declared = options.declared ? buildRuleSet(options.declared, caseId) : { path: [], content: [], canary: [] };
  const legacy = resolveLegacyRules(caseId);
  const ruleSet = mergeLegacyRules(declared, legacy);
  const findings = scanWorkspace(workspace, ruleSet);
  if (options.detailed) return findings;
  return findings.map(f => ({
    file: f.file,
    rule: f.pattern,
    source: f.source,
    ...(f.line != null ? { line: f.line } : {}),
    ...(f.recovery ? { recovery: f.recovery } : {}),
    ...(f.rule_id ? { rule_id: f.rule_id } : {}),
  }));
}

export function createRunLayout(projectRoot, runId) {
  const runDir = resolve(projectRoot, '.local', 'runs', runId);
  for (const part of ['input', 'workspace', 'logs', 'artifacts', 'review', '.empty-skills']) {
    mkdirSync(join(runDir, part), { recursive: true });
  }
  writeFileSync(
    join(runDir, 'ISOLATION.md'),
    [
      '# File-isolated development run',
      '',
      'This run uses a clean directory and answer-leakage scan.',
      'It does not provide OS-level read isolation and is not leaderboard eligible.',
      '',
    ].join('\n'),
  );
  return runDir;
}
