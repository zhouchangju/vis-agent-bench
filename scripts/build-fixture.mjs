#!/usr/bin/env node
/**
 * Fixture Builder CLI.
 *
 * Usage:
 *   node scripts/build-fixture.mjs \
 *     --case <case-id> \
 *     --source-root <path> \
 *     --export-root <path> \
 *     [--plan <path-to-plan.yaml>] \
 *     [--baseline-step build=true,typecheck=true,test=false] \
 *     [--canary-name marker] ... \
 *     [--dry-run]
 *
 * Output: a single result envelope with the standard shape
 *   { status, summary, next_actions, artifacts, ... }
 *
 * This CLI is intentionally narrow: it builds ONE fixture. Multi-case
 * orchestration belongs to VAB-T08.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { buildFixture, BUILDER_VERSION } from '../src/fixtures/builder.mjs';
import { loadCaseFixturePlan } from '../src/fixtures/index.mjs';

const projectRoot = resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const parsed = { canary_names: [], baseline_override: null, plan_path: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2).replaceAll('-', '_');
    const next = argv[i + 1];
    if (key === 'canary_name') {
      if (next == null || next.startsWith('--')) {
        fail(`--canary-name requires a value`);
      }
      parsed.canary_names.push(next);
      i += 1;
      continue;
    }
    if (key === 'baseline_step') {
      if (next == null || next.startsWith('--')) {
        fail(`--baseline-step requires a value like build=true`);
      }
      parsed.baseline_override = parsed.baseline_override || {};
      const [step, value] = next.split('=');
      if (!step || !['true', 'false'].includes(value)) {
        fail(`--baseline-step must look like build=true or test=false; got: ${next}`);
      }
      parsed.baseline_override[step] = value === 'true';
      i += 1;
      continue;
    }
    if (next == null || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function requireOption(args, key, label) {
  if (!args[key]) {
    fail(`Missing required option --${label || key.replaceAll('_', '-')}`);
  }
  return args[key];
}

function emit(envelope) {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

function fail(message, extra = {}) {
  emit({
    status: 'error',
    summary: message,
    next_actions: [
      'See scripts/build-fixture.mjs --help style usage in the script header.',
      'Resolve the reported issue, then rerun the build.',
    ],
    artifacts: [],
    error: {
      root_cause_hint: message,
      safe_retry: 'Fix inputs and rerun; do not bypass gates.',
      stop_condition: 'Stop after two identical build failures and escalate.',
    },
    ...extra,
  });
  process.exitCode = 1;
  // eslint-disable-next-line no-process-exit
  process.exit(process.exitCode || 1);
}

function applyBaselineOverride(plan, override) {
  if (!override) return plan?.baseline;
  const base = structuredClone(plan?.baseline || {});
  for (const [step, enable] of Object.entries(override)) {
    if (enable) {
      if (!base[step]) {
        // The CLI cannot invent commands; if the Case declared none, we leave
        // it as a no-op placeholder so the gate reports it as skipped rather
        // than fabricating a build.
        base[step] = { command: [], required: true };
      } else {
        base[step] = { ...base[step], required: true };
      }
    } else {
      // Disabled steps are removed entirely.
      delete base[step];
    }
  }
  return base;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write(`${headerUsage()}\n`);
    return;
  }

  const caseId = requireOption(args, 'case', 'case');
  const sourceRoot = resolve(requireOption(args, 'source_root', 'source-root'));
  const exportRoot = resolve(requireOption(args, 'export_root', 'export-root'));
  const caseRoot = resolve(projectRoot, 'cases', caseId);

  if (!existsSync(sourceRoot)) {
    fail(`--source-root does not exist: ${sourceRoot}`);
  }
  if (!existsSync(caseRoot)) {
    fail(`Unknown case directory: ${caseRoot}`);
  }

  // Load the Case plan if the operator did not override it.
  let planSource;
  const planArg = args.plan_path || args.plan; // --plan or --plan-path
  if (planArg) {
    const planPath = resolve(planArg);
    if (!existsSync(planPath)) fail(`--plan not found: ${planPath}`);
    planSource = parseYaml(readFileSync(planPath, 'utf8'));
  } else {
    const loaded = loadCaseFixturePlan(caseRoot);
    planSource = loaded.plan || {};
  }
  const baseline = applyBaselineOverride(planSource, args.baseline_override);

  const input = {
    case_id: caseId,
    source_root: sourceRoot,
    export_root: exportRoot,
    source_descriptor: {
      label: planSource?.source?.label || caseId,
      source_type: planSource?.source?.type || 'synthetic',
    },
    exclusion: planSource?.exclusion,
    leakage: planSource?.leakage,
    baseline,
    provenance: Array.isArray(planSource?.provenance) ? planSource.provenance : [],
    patches: Array.isArray(planSource?.patches) ? planSource.patches : [],
    canary_names: [...(Array.isArray(planSource?.canary_names) ? planSource.canary_names : []), ...args.canary_names],
    notes: Array.isArray(planSource?.notes)
      ? planSource.notes
      : ['Built via scripts/build-fixture.mjs; VAB-T08 will wire this into the bench CLI.'],
  };

  if (args.dry_run) {
    emit({
      status: 'success',
      summary: `Dry-run resolved inputs for ${caseId}; no gates were executed.`,
      next_actions: ['Remove --dry-run to actually build the fixture.'],
      artifacts: [],
      plan: { ...planSource, baseline },
      builder_version: BUILDER_VERSION,
      input_summary: {
        case_id: caseId,
        source_root: sourceRoot,
        export_root: exportRoot,
        canary_count: input.canary_names.length,
        patch_count: input.patches.length,
      },
    });
    return;
  }

  const result = buildFixture(input);
  emit(result);
  if (result.status === 'error') process.exitCode = 1;
  else if (result.status === 'warning') process.exitCode = 0;
}

function headerUsage() {
  return [
    'Usage: node scripts/build-fixture.mjs \\',
    '  --case <case-id> --source-root <path> --export-root <path>',
    '  [--plan <plan.yaml>] [--baseline-step build=true] [--canary-name marker]',
    '  [--dry-run]',
    '',
    'Builds one sanitised, leak-checked, baseline-verified fixture and writes a',
    'machine-readable manifest under <export-root>/.fixture/manifest.json.',
    '',
  ].join('\n');
}

main();
