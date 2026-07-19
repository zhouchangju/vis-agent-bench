import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  resolveExclusionConfig,
  compileExclusionFilter,
} from './exclusion.mjs';
import {
  buildRuleSet,
  mergeLegacyRules,
  scanWorkspace,
  hashRuleSet,
  hashFiles,
  resolveLegacyRules,
} from './leakage.mjs';
import {
  resolveBaselineSteps,
  runBaselineGate,
} from './baseline-gate.mjs';
import {
  MANIFEST_VERSION,
  computeFixtureDigest,
  serialiseManifest,
  validateManifest,
} from './manifest.mjs';

export const BUILDER_VERSION = '1.0.0';

/**
 * Lifecycle:
 *
 *   scaffold (copy source) → exclusion filter → compile-clean patch
 *     → leakage scan → baseline gate → manifest → publish to export root
 *
 * The export is the *only* directory a downstream consumer (Runner, Agent)
 * should ever see. If any required gate fails the export is removed and the
 * manifest is marked `rejected`, so we never publish a half-built fixture.
 */

/**
 * @typedef {Object} BuildInput
 * @property {string} case_id
 * @property {string} source_root               Directory to scaffold from (may be a clean template or a sanitised snapshot).
 * @property {string} export_root               Final fixture directory; created or replaced.
 * @property {Object} [source_descriptor]       Case-declared source description.
 * @property {Object} [exclusion]               Case-declared exclusion fragment.
 * @property {Object} [leakage]                 Case-declared leakage rules fragment.
 * @property {Object} [baseline]                Case-declared baseline steps fragment.
 * @property {Array<ProvenanceEntry>} provenance
 * @property {Array<CompileCleanPatch>} [patches]
 * @property {Array<string>} [canary_names]     Canary names to inject into the rule set (only their hash is recorded).
 * @property {boolean} [publish_on_failure=false]
 * @property {Object} [gate_env]                environment override for baseline gate
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} ProvenanceEntry
 * @property {string} kind
 * @property {string} label
 * @property {string} [ref]
 * @property {string} [digest]
 * @property {string} [source_type]
 * @property {boolean} [modified]
 */

/**
 * @typedef {Object} CompileCleanPatch
 * @property {string} [path]                   File to patch (relative to workspace).
 * @property {string} [old]                    Old text to replace (with apply: 'replace').
 * @property {string} [new]                    New text (with apply: 'replace').
 * @property {string} [content]                Full file content (with apply: 'write').
 * @property {'write'|'replace'|'delete'} [apply='write']
 * @property {string} [reason]
 */

export function buildFixture(input) {
  const errors = validateInput(input);
  if (errors.length) {
    return fail('Invalid fixture build input.', errors, [], input);
  }

  if (!existsSync(input.source_root)) {
    return fail(`Source root does not exist: ${input.source_root}`, [`source_root: ${input.source_root}`], [], input);
  }

  const staging = join(tmpdir(), `vab-fixture-${input.case_id}-${randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  let cleanup = () => {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  const artifacts = [];
  const stageLogs = [];

  try {
    // 1. Scaffold: copy from source into staging using the exclusion filter.
    const exclusionConfig = resolveExclusionConfig(input.exclusion);
    const exclude = compileExclusionFilter(exclusionConfig);
    copyWithExclusion(input.source_root, staging, exclude);
    stageLogs.push({
      stage: 'scaffold',
      status: 'ok',
      source_root: input.source_root,
      staging_root: staging,
      exclusion: serialiseExclusionSummary(exclusionConfig),
    });

    // 2. Apply compile-clean patches (these only *remove* answer-bearing
    //    references so the starting project compiles without leaking answers).
    const patchLog = applyPatches(staging, input.patches || []);
    stageLogs.push({ stage: 'compile-clean-patch', status: patchLog.failures.length ? 'failed' : 'ok', ...patchLog });
    if (patchLog.failures.length) {
      return fail(
        'Compile-clean patches failed to apply; refusing to publish a fixture that may leak answers.',
        patchLog.failures.map(f => `patch ${f.path} (${f.apply}): ${f.reason}`),
        [],
        input,
        { cleanup, stage_logs: stageLogs },
      );
    }

    // 3. Leakage scan against Case-declared + legacy rules. Canary names
    //    become advisory canary rules (never blocking); the legacy per-Case
    //    hard-coded patterns stay as blocking path/content rules.
    const declaredRuleSet = buildRuleSet(input.leakage, input.case_id);
    const legacyRules = resolveLegacyRules(input.case_id);
    const canaryRules = (input.canary_names || [])
      .map(name => ({ id: `canary_${String(name).replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`, pattern: new RegExp(escapeRegExp(String(name)), 'i'), recovery: 'Scrub the canary marker or document an explicit exemption before ranking.' }));
    const ruleSet = mergeLegacyRules({
      path: [...(declaredRuleSet.path || []), ...legacyRules],
      content: [...(declaredRuleSet.content || []), ...legacyRules],
      canary: [...(declaredRuleSet.canary || []), ...canaryRules],
    });
    const ruleSetDigest = hashRuleSet(ruleSet);
    const findings = scanWorkspace(staging, ruleSet);
    const findingCounts = countFindings(findings);
    stageLogs.push({
      stage: 'leakage-scan',
      status: findings.length ? 'findings' : 'clean',
      finding_counts: findingCounts,
      rule_set_digest: ruleSetDigest,
    });
    const leakageLogPath = join(staging, '.fixture', 'leakage-scan.json');
    mkdirSync(join(staging, '.fixture'), { recursive: true });
    writeFileSync(leakageLogPath, `${JSON.stringify(findings, null, 2)}\n`);

    // Path/content findings are blocking. Canary findings are advisory: the
    // fixture can still be published but the manifest surfaces the count so a
    // reviewer must sign off before ranking.
    const blockingFindings = findings.filter(f => f.source !== 'canary');
    if (blockingFindings.length) {
      return fail(
        `Leakage scan found ${blockingFindings.length} blocking finding(s); fixture not published.`,
        blockingFindings.map(f => `${f.file} [${f.source}:${f.rule_id}] → ${f.recovery}`),
        [],
        input,
        {
          cleanup,
          stage_logs: stageLogs,
          leakage_findings: findings,
          leakage_finding_counts: findingCounts,
          leakage_rule_set_digest: ruleSetDigest,
        },
      );
    }

    // 4. Baseline gate. Only runs what the Case declared.
    const baselineSteps = resolveBaselineSteps(input.baseline);
    const gateLogsRoot = join(staging, '.fixture', 'baseline');
    const gate = runBaselineGate({
      workspaceRoot: staging,
      steps: baselineSteps,
      logsRoot: gateLogsRoot,
      env: input.gate_env,
      signal: input.signal,
    });
    stageLogs.push({ stage: 'baseline-gate', status: gate.status, step_count: gate.steps.length });
    if (gate.status === 'failed') {
      return fail(
        'Baseline gate failed; refusing to publish a non-compiling fixture.',
        gate.steps.filter(s => s.status === 'failed').map(s => `baseline.${s.type} exited ${s.exit_code} (see ${s.log_path || 'log'})`),
        [],
        input,
        { cleanup, stage_logs: stageLogs, baseline: gate },
      );
    }

    // 5. Build manifest. Never embed file contents.
    const fileEntries = hashFiles(staging);
    const fixtureDigest = computeFixtureDigest(fileEntries);
    const provenance = (input.provenance || []).map(entry => ({
      kind: entry.kind,
      label: entry.label,
      ...(entry.ref ? { ref: entry.ref } : {}),
      ...(entry.digest ? { digest: entry.digest } : {}),
      source_type: entry.source_type || input.source_descriptor?.source_type || 'observed',
      modified: entry.modified === true || (input.patches && input.patches.length > 0),
    }));
    const manifest = {
      manifest_version: MANIFEST_VERSION,
      case_id: input.case_id,
      source_descriptor: input.source_descriptor?.label ?? null,
      source_type: input.source_descriptor?.source_type ?? 'synthetic',
      provenance,
      leakage: {
        rule_set_digest: ruleSetDigest,
        finding_counts: findingCounts,
      },
      baseline: gate,
      files: fileEntries,
      export: {
        fixture_root: resolve(input.export_root),
        fixture_digest: fixtureDigest,
        status: 'verified',
        produced_at: new Date().toISOString(),
        builder_version: BUILDER_VERSION,
        environment: collectEnvironment(),
      },
      notes: input.notes || [],
    };
    const manifestIssues = validateManifest(manifest);
    if (manifestIssues.length) {
      return fail(
        'Manifest failed structural validation; fixture not published.',
        manifestIssues.map(issue => `${issue.path}: ${issue.message}`),
        [],
        input,
        { cleanup, stage_logs: stageLogs, manifest_validation: manifestIssues },
      );
    }
    writeFileSync(join(staging, '.fixture', 'manifest.json'), serialiseManifest(manifest));
    writeFileSync(join(staging, '.fixture', 'stage-log.json'), `${JSON.stringify(stageLogs, null, 2)}\n`);

    // 6. Publish: replace export root with the verified staging copy.
    publishExport(staging, input.export_root, manifest);
    artifacts.push(join(input.export_root, '.fixture', 'manifest.json'));
    artifacts.push(join(input.export_root, '.fixture', 'stage-log.json'));
    artifacts.push(join(input.export_root, '.fixture', 'leakage-scan.json'));
    for (const step of gate.steps) {
      if (step.log_path) artifacts.push(join(input.export_root, '.fixture', 'baseline', step.log_path));
    }

    cleanup();
    cleanup = () => {};

    const advisoryIssues = (gate.steps || []).filter(s => s.status === 'failed' && !s.required).length
      + (findingCounts.canary || 0);
    const status = advisoryIssues > 0 ? 'warning' : 'success';
    return {
      status,
      summary: `Fixture for ${input.case_id} built and published (${fileEntries.length} files).`,
      next_actions: [
        'Consume the fixture via VAB-T08 integration; do not bypass the manifest hash check.',
        ...(findingCounts.canary ? ['Review canary findings before treating this run as leaderboard eligible.'] : []),
      ],
      artifacts,
      manifest,
      stage_logs: stageLogs,
      leakage_findings: findings,
      leakage_finding_counts: findingCounts,
    };
  } catch (error) {
    return fail(
      `Fixture build crashed: ${error.message}`,
      [error.stack || error.message],
      [],
      input,
      { cleanup, stage_logs: stageLogs },
    );
  } finally {
    cleanup();
  }
}

function validateInput(input) {
  const errors = [];
  if (!input) {
    errors.push('input is required');
    return errors;
  }
  if (typeof input.case_id !== 'string' || !input.case_id) errors.push('case_id must be a non-empty string');
  if (typeof input.source_root !== 'string' || !input.source_root) errors.push('source_root must be a non-empty string');
  if (typeof input.export_root !== 'string' || !input.export_root) errors.push('export_root must be a non-empty string');
  if (!Array.isArray(input.provenance)) errors.push('provenance must be an array');
  return errors;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function copyWithExclusion(source, target, exclude) {
  cpSync(source, target, {
    recursive: true,
    preserveTimestamps: true,
    filter: (src) => {
      // cpSync calls the filter with the source path; compute the relative
      // path against the source root and ask the predicate. We also keep the
      // target itself even if its basename matched a leaf rule, so the copy
      // can never silently produce an empty export.
      if (src === source) return true;
      const rel = relative(source, src);
      return !exclude(rel, false);
    },
  });
}

function applyPatches(workspaceRoot, patches) {
  const applied = [];
  const failures = [];
  for (const patch of patches) {
    const path = patch.path;
    if (!path) {
      failures.push({ path: '<missing>', apply: patch.apply || 'write', reason: 'patch.path is required' });
      continue;
    }
    const absolute = join(workspaceRoot, path);
    const apply = patch.apply || 'write';
    try {
      if (apply === 'delete') {
        if (existsSync(absolute)) rmSync(absolute, { recursive: true, force: true });
        applied.push({ path, apply });
        continue;
      }
      if (apply === 'replace') {
        if (!existsSync(absolute)) {
          failures.push({ path, apply, reason: 'file does not exist' });
          continue;
        }
        const original = readFileSync(absolute, 'utf8');
        if (!original.includes(patch.old)) {
          failures.push({ path, apply, reason: 'patch.old text not found' });
          continue;
        }
        const updated = patch.old.length === 0 ? patch.new : original.split(patch.old).join(patch.new);
        writeFileSync(absolute, updated);
        applied.push({ path, apply });
        continue;
      }
      // apply === 'write'
      mkdirSync(resolve(absolute, '..'), { recursive: true });
      writeFileSync(absolute, patch.content ?? '');
      applied.push({ path, apply });
    } catch (error) {
      failures.push({ path, apply, reason: error.message });
    }
  }
  return { applied, failures };
}

function countFindings(findings) {
  const counts = { path: 0, content: 0, canary: 0 };
  for (const finding of findings) counts[finding.source] = (counts[finding.source] || 0) + 1;
  return counts;
}

function publishExport(staging, exportRoot, manifest) {
  if (existsSync(exportRoot)) rmSync(exportRoot, { recursive: true, force: true });
  mkdirSync(resolve(exportRoot, '..'), { recursive: true });
  cpSync(staging, exportRoot, {
    recursive: true,
    preserveTimestamps: true,
  });
  // Mark the export boundary so downstream tooling can refuse to write into it.
  writeFileSync(join(exportRoot, '.fixture', 'EXPORTED'), `published ${manifest.export.produced_at}\n`);
}

function collectEnvironment() {
  return {
    node: typeof process !== 'undefined' ? process.version : 'unknown',
    platform: typeof process !== 'undefined' && typeof process.platform === 'string' ? process.platform : 'unknown',
    arch: typeof process !== 'undefined' && typeof process.arch === 'string' ? process.arch : 'unknown',
  };
}

function serialiseExclusionSummary(config) {
  return {
    extend_defaults: config.extend_defaults,
    groups: Object.fromEntries(Object.entries(config.groups).map(([k, v]) => [k, v.length])),
    globs: config.globs,
  };
}

function fail(summary, nextActions, artifacts, input, extra = {}) {
  if (extra.cleanup) extra.cleanup();
  return {
    status: 'error',
    summary,
    next_actions: nextActions.length ? nextActions : ['Fix the reported issue and rerun the build.'],
    artifacts,
    error: {
      root_cause_hint: summary,
      safe_retry: 'Resolve the listed issues, then rerun buildFixture. Do not bypass gates.',
      stop_condition: 'Stop after two identical build failures and escalate to the operator.',
    },
    ...(extra.stage_logs ? { stage_logs: extra.stage_logs } : {}),
    ...(extra.leakage_findings ? { leakage_findings: extra.leakage_findings } : {}),
    ...(extra.leakage_finding_counts ? { leakage_finding_counts: extra.leakage_finding_counts } : {}),
    ...(extra.leakage_rule_set_digest ? { leakage_rule_set_digest: extra.leakage_rule_set_digest } : {}),
    ...(extra.baseline ? { baseline: extra.baseline } : {}),
    ...(extra.manifest_validation ? { manifest_validation: extra.manifest_validation } : {}),
    ...(input && input.case_id ? { case_id: input.case_id } : {}),
  };
}
