import { runEvaluation } from '../../core/index.mjs';
import {
  annotateEvaluationTrust,
  resolveObservationInput,
} from '../../control/observation-attestation.mjs';
import { createStandardChartChecks, registeredAssertionIds } from './checks.mjs';
import { loadStandardChartRubric, rubricCheckIds } from './rubric.mjs';

export const STANDARD_CHART_TWO_WAY_TREE_CASE_ID = 'standard-chart-two-way-tree';

export function createStandardChartTwoWayTreeEvaluator({
  observation,
  observationPath,
  attestationPath,
  runRoot,
  runId,
  allowTestDouble = false,
  rubric = loadStandardChartRubric(),
} = {}) {
  const resolved = resolveObservationInput({
    caseId: STANDARD_CHART_TWO_WAY_TREE_CASE_ID,
    runId,
    runRoot,
    attestationPath,
    observation,
    observationPath,
    allowTestDouble,
  });
  const resolvedObservation = resolved.observation;
  validateObservation(resolvedObservation);
  validateCheckMapping(rubric);

  return {
    caseId: STANDARD_CHART_TWO_WAY_TREE_CASE_ID,
    rubric,
    checks: createStandardChartChecks(rubric),
    prepare() {
      return { observation: resolvedObservation };
    },
    resolvedObservation,
    evidenceTrust: resolved.trust,
    notes: [
      'Deterministic tree structure, bidirectional traversal, selection, layout integrity, and performance proxies only.',
      'Real-browser observations do not prove layout aesthetics, animation feel, or cross-browser parity.',
    ].join(' '),
  };
}

export async function evaluateStandardChartTwoWayTree(options = {}) {
  const evaluator = createStandardChartTwoWayTreeEvaluator(options);
  const observation = evaluator.resolvedObservation;
  const evaluation = await runEvaluation(evaluator, {
    runId: options.runId,
    workspace: options.workspace,
    logsDir: options.logsDir,
    runTimeoutMs: options.runTimeoutMs,
    scoring: {
      capTriggers: {
        screenshot_or_hardcoded_layout_max_score:
          options.screenshotOrHardcodedLayout === true
          || observation.layout?.hardcodedCoordinates === true
          || observation.layout?.rasterFallback === true,
      },
    },
  });
  return annotateEvaluationTrust(evaluation, evaluator.evidenceTrust);
}

export function validateCheckMapping(rubric = loadStandardChartRubric()) {
  const declared = rubricCheckIds(rubric).sort();
  const registered = registeredAssertionIds();
  const missing = declared.filter(id => !registered.includes(id));
  const undeclared = registered.filter(id => !declared.includes(id));
  const duplicate = declared.filter((id, index) => declared.indexOf(id) !== index);
  if (missing.length || undeclared.length || duplicate.length) {
    throw new Error(`StandardChart two-way-tree rubric/check mismatch: ${JSON.stringify({ missing, undeclared, duplicate })}`);
  }
  for (const id of rubric.hard_gates || []) {
    if (!declared.includes(id)) throw new Error(`Hard gate "${id}" is not a rubric check.`);
  }
  return {
    declared,
    registered,
    hardGates: [...(rubric.hard_gates || [])],
  };
}

function validateObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('StandardChart two-way-tree observation must be an object.');
  }
  for (const key of [
    'commands',
    'input',
    'tree_structure',
    'bidirectional_traversal',
    'node_selection',
    'layout',
    'performance',
    'browserEvidence',
    'responsive',
    'accessibility',
    'engineering',
  ]) {
    if (!observation[key] || typeof observation[key] !== 'object') {
      throw new TypeError(`StandardChart two-way-tree observation is missing "${key}".`);
    }
  }
}

export {
  FOCUS_DRIFT_TOLERANCE,
  LARGE_TREE_NODE_BUDGET,
  OVERLAP_TOLERANCE,
  bidirectionalReachable,
  overlapFailures,
} from './math.mjs';
export { treeStatesEqual, canonicalTreeState } from './state.mjs';
