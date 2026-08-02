import { runEvaluation } from '../../core/index.mjs';
import {
  annotateEvaluationTrust,
  resolveObservationInput,
} from '../../control/observation-attestation.mjs';

export const MEMORY_EFFECTIVENESS_SMOKE_CASE_ID = 'memory-effectiveness-smoke';

export const MEMORY_EFFECTIVENESS_SMOKE_RUBRIC = Object.freeze({
  version: 1,
  total: 100,
  hard_gates: ['semantic-version-order'],
  categories: {
    historical_trap: {
      weight: 80,
      checks: ['semantic-version-order'],
    },
    memory_trace: {
      weight: 20,
      checks: ['approved-memory-trace'],
    },
  },
  caps: {
    p0_failure_max_score: 0,
    incomplete_cap: 0,
  },
});

function validateObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('Memory effectiveness observation must be an object.');
  }
  if (!['off', 'approved_only'].includes(observation.arm)) {
    throw new TypeError('Memory effectiveness observation arm must be off or approved_only.');
  }
  if (!Array.isArray(observation.sortedVersions) || observation.sortedVersions.some(value => typeof value !== 'string')) {
    throw new TypeError('Memory effectiveness observation sortedVersions must be a string array.');
  }
  if (!Array.isArray(observation.selectedMemoryIds)) {
    throw new TypeError('Memory effectiveness observation selectedMemoryIds must be an array.');
  }
}

export function createMemoryEffectivenessSmokeEvaluator({
  observation,
  observationPath,
  attestationPath,
  runRoot,
  runId,
  allowTestDouble = false,
  rubric = MEMORY_EFFECTIVENESS_SMOKE_RUBRIC,
} = {}) {
  const resolved = resolveObservationInput({
    caseId: MEMORY_EFFECTIVENESS_SMOKE_CASE_ID,
    runId,
    runRoot,
    attestationPath,
    observation,
    observationPath,
    allowTestDouble,
  });
  const resolvedObservation = resolved.observation;
  validateObservation(resolvedObservation);
  const expected = ['1.9.0', '1.10.0', '2.0.0'];
  return {
    caseId: MEMORY_EFFECTIVENESS_SMOKE_CASE_ID,
    rubric,
    checks: [
      {
        id: 'semantic-version-order',
        title: 'Sort semantic versions by numeric segments',
        kind: 'machine',
        level: 'p0',
        hard_gate: true,
        run() {
          const pass = JSON.stringify(resolvedObservation.sortedVersions) === JSON.stringify(expected);
          return {
            status: pass ? 'pass' : 'fail',
            reason: pass ? null : 'Lexicographic ordering reproduces the historical 1.10.0 versus 1.9.0 trap.',
            evidence: {
              expected,
              actual: resolvedObservation.sortedVersions,
              source: 'deterministic-fixture',
            },
          };
        },
      },
      {
        id: 'approved-memory-trace',
        title: 'Record whether the approved trap memory was selected',
        kind: 'machine',
        level: 'p1',
        run() {
          const traced = resolvedObservation.arm === 'off'
            ? resolvedObservation.selectedMemoryIds.length === 0
            : resolvedObservation.selectedMemoryIds.includes('memory_semver_numeric_sort');
          return {
            status: traced ? 'pass' : 'fail',
            reason: traced ? null : 'Arm trace does not contain the expected intervention.',
            evidence: {
              arm: resolvedObservation.arm,
              selectedMemoryIds: resolvedObservation.selectedMemoryIds,
            },
          };
        },
      },
    ],
    prepare() {
      return {};
    },
    evidenceTrust: resolved.trust,
    notes: 'Deterministic backup Case. It calls no model and proves only the synthetic semantic-version historical trap.',
  };
}

export async function evaluateMemoryEffectivenessSmoke(options = {}) {
  const evaluator = createMemoryEffectivenessSmokeEvaluator(options);
  const evaluation = await runEvaluation(evaluator, {
    runId: options.runId,
    workspace: options.workspace,
    logsDir: options.logsDir,
    runTimeoutMs: options.runTimeoutMs,
  });
  return annotateEvaluationTrust(evaluation, evaluator.evidenceTrust);
}
