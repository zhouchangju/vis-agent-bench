/**
 * Public Fixture Builder API.
 *
 * VAB-T08 wires `buildFixtureFromCase` into the bench CLI. Each piece is also
 * exported separately so reviewers and tests can exercise the lifecycle
 * without going through the CLI.
 */

export { buildFixture, BUILDER_VERSION } from './builder.mjs';
export { resolveExclusionConfig, compileExclusionFilter, DEFAULT_EXCLUSION_GROUPS } from './exclusion.mjs';
export {
  buildRuleSet,
  mergeLegacyRules,
  normalizeRule,
  scanWorkspace,
  hashRuleSet,
  hashFiles,
} from './leakage.mjs';
export { resolveBaselineSteps, runBaselineGate, STEP_TYPES } from './baseline-gate.mjs';
export {
  MANIFEST_VERSION,
  computeFixtureDigest,
  serialiseManifest,
  validateManifest,
} from './manifest.mjs';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { buildFixture } from './builder.mjs';

/**
 * Resolve the Case-declared fixture configuration.
 *
 * A Case may declare its fixture plan inline in `fixture/plan.yaml` (the
 * VAB-T02 contract) and/or by referencing a source repository in
 * `provenance.md`. We only read the YAML file: prose stays prose and is never
 * parsed as data.
 *
 * @param {string} caseRoot
 * @returns {{ plan: Object|null, path: string|null }}
 */
export function loadCaseFixturePlan(caseRoot) {
  const candidates = [
    join(caseRoot, 'fixture', 'plan.yaml'),
    join(caseRoot, 'fixture', 'plan.yml'),
    join(caseRoot, 'fixture', 'fixture.yaml'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return { plan: parseYaml(readFileSync(path, 'utf8')), path };
    }
  }
  return { plan: null, path: null };
}

/**
 * Convenience: drive the full lifecycle using a Case-declared plan plus an
 * explicit `source_root` and `export_root`. VAB-T08 passes those in from the
 * RunSpec; this helper does not invent them.
 *
 * @param {Object} params
 * @param {string} params.caseRoot
 * @param {string} params.source_root
 * @param {string} params.export_root
 * @param {Object} [params.planOverride]
 * @param {AbortSignal} [params.signal]
 */
export function buildFixtureFromCase({ caseRoot, source_root, export_root, planOverride, signal }) {
  const { plan } = planOverride ? { plan: planOverride } : loadCaseFixturePlan(caseRoot);
  const input = {
    case_id: basenameCaseId(caseRoot),
    source_root,
    export_root,
    source_descriptor: {
      label: plan?.source?.label || basenameCaseId(caseRoot),
      source_type: plan?.source?.type || 'synthetic',
    },
    exclusion: plan?.exclusion,
    leakage: plan?.leakage,
    baseline: plan?.baseline,
    provenance: Array.isArray(plan?.provenance) ? plan.provenance : [],
    patches: Array.isArray(plan?.patches) ? plan.patches : [],
    canary_names: Array.isArray(plan?.canary_names) ? plan.canary_names : [],
    notes: Array.isArray(plan?.notes) ? plan.notes : [],
    signal,
  };
  return buildFixture(input);
}

function basenameCaseId(caseRoot) {
  const parts = String(caseRoot).replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown-case';
}
