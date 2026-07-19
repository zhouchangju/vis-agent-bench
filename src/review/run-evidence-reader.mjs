import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { validateEvidencePackage } from '../browser-evidence/evidence-package.mjs';

/**
 * Read a benchmark Run directory and expose the machine evidence a reviewer
 * needs. VAB-T06 only reads; it must never mutate Run directories.
 *
 * Run layout (produced by bench.mjs):
 *   <runDir>/
 *     run-spec.json
 *     result.json
 *     artifacts/workspace.diff
 *     logs/commands.json
 *     logs/stages/<stage>/stdout.raw
 *     logs/stages/<stage>/stderr.raw
 *     logs/stages/<stage>/normalized-events.jsonl
 *     review/browser-evidence.json   ← produced by capture-browser-evidence.mjs
 */

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function safeRead(path, limit = 4096) {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf8');
    return content.length > limit ? `${content.slice(0, limit)}\n…(truncated)` : content;
  } catch {
    return null;
  }
}

function listStageIds(stagesDir) {
  if (!existsSync(stagesDir)) return [];
  return readdirSync(stagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function summarizeStageLogs(stagesDir, stageId) {
  const stageDir = join(stagesDir, stageId);
  return {
    stage_id: stageId,
    stdout_excerpt: safeRead(join(stageDir, 'stdout.raw')),
    stderr_excerpt: safeRead(join(stageDir, 'stderr.raw')),
    normalized_events_path: existsSync(join(stageDir, 'normalized-events.jsonl'))
      ? join(stageDir, 'normalized-events.jsonl')
      : null,
  };
}

/**
 * Read the machine evidence for a Run. Returns a structured object the
 * review UI consumes; never throws — missing artifacts become null fields.
 */
export function readRunEvidence(runDir) {
  const root = resolve(runDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return {
      run_dir: root,
      available: false,
      run_spec: null,
      result: null,
      commands: null,
      workspace_diff_path: null,
      stage_logs: [],
      browser_evidence: null,
      browser_evidence_errors: [],
    };
  }
  const runSpec = readJson(join(root, 'run-spec.json'));
  const result = readJson(join(root, 'result.json'));
  const commands = readJson(join(root, 'logs', 'commands.json'));
  const workspaceDiffPath = join(root, 'artifacts', 'workspace.diff');
  const stageLogsRoot = join(root, 'logs', 'stages');
  const stageIds = listStageIds(stageLogsRoot);
  const stageLogs = stageIds.map(id => summarizeStageLogs(stageLogsRoot, id));

  const browserEvidencePath = join(root, 'review', 'browser-evidence.json');
  let browserEvidence = null;
  let browserEvidenceErrors = [];
  if (existsSync(browserEvidencePath)) {
    const candidate = readJson(browserEvidencePath);
    if (candidate) {
      const validation = validateEvidencePackage(candidate);
      if (validation.valid) {
        browserEvidence = candidate;
      } else {
        browserEvidence = candidate;
        browserEvidenceErrors = validation.errors;
      }
    } else {
      browserEvidenceErrors = [{ path: '$', code: 'PARSE_ERROR', message: 'browser-evidence.json is not valid JSON.' }];
    }
  }

  return {
    run_dir: root,
    available: true,
    run_spec: runSpec,
    result,
    commands,
    workspace_diff_path: existsSync(workspaceDiffPath) ? workspaceDiffPath : null,
    workspace_diff_excerpt: safeRead(workspaceDiffPath),
    stage_logs: stageLogs,
    browser_evidence_path: existsSync(browserEvidencePath) ? browserEvidencePath : null,
    browser_evidence: browserEvidence,
    browser_evidence_errors: browserEvidenceErrors,
  };
}

/**
 * Build a reviewer-facing summary of a Run's machine evidence. The summary
 * powers the evidence card in the review prototype and is safe to log.
 */
export function summarizeRunEvidence(evidence) {
  if (!evidence || !evidence.available) {
    return {
      available: false,
      summary: 'No machine evidence available for this Run.',
      hints: ['Run the CLI first, then capture browser evidence into <runDir>/review/.'],
    };
  }
  const run = evidence.result ?? {};
  const be = evidence.browser_evidence;
  return {
    available: true,
    summary: `Run ${run.run_id ?? '<unknown>'} · status ${run.status ?? 'unknown'} · case ${evidence.run_spec?.case_id ?? '<unknown>'}`,
    case_id: evidence.run_spec?.case_id ?? null,
    run_id: run.run_id ?? evidence.run_spec?.run_id ?? null,
    run_status: run.status ?? null,
    engine: evidence.run_spec?.engine ?? null,
    isolation: evidence.run_spec?.isolation ?? null,
    stage_ids: (evidence.run_spec?.scenario?.stage_ids ?? []),
    duration_ms: run.duration_ms ?? null,
    workspace_diff_present: Boolean(evidence.workspace_diff_path),
    browser_evidence_present: Boolean(be),
    browser_evidence_status: be?.status ?? null,
    screenshot_count: be?.screenshots?.length ?? 0,
    dom_snapshot_count: be?.dom_snapshots?.length ?? 0,
    failure_count: be?.failures?.length ?? 0,
    hints: [],
  };
}
