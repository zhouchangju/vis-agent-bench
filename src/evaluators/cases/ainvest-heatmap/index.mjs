import { runEvaluation } from '../../core/index.mjs';
import {
  annotateEvaluationTrust,
  resolveObservationInput,
} from '../../control/observation-attestation.mjs';
import { createAinvestHeatmapChecks, registeredAssertionIds } from './checks.mjs';
import { loadAinvestHeatmapRubric, rubricCheckIds } from './rubric.mjs';

export const AINVEST_HEATMAP_CASE_ID = 'ainvest-market-heatmap-rebuild';

export function createAinvestHeatmapEvaluator({
  observation,
  observationPath,
  attestationPath,
  runRoot,
  runId,
  allowTestDouble = false,
  rubric = loadAinvestHeatmapRubric(),
} = {}) {
  const resolved = resolveObservationInput({
    caseId: AINVEST_HEATMAP_CASE_ID,
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
    caseId: AINVEST_HEATMAP_CASE_ID,
    rubric,
    checks: createAinvestHeatmapChecks(rubric),
    prepare() {
      return { observation: resolvedObservation };
    },
    resolvedObservation,
    evidenceTrust: resolved.trust,
    notes: [
      'Deterministic data, behavior, state, and accessibility proxies only.',
      'Real-browser observations do not prove aesthetics, visual parity, or cross-browser quality.',
    ].join(' '),
  };
}

export async function evaluateAinvestHeatmap(options = {}) {
  const evaluator = createAinvestHeatmapEvaluator(options);
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

export function validateCheckMapping(rubric = loadAinvestHeatmapRubric()) {
  const declared = rubricCheckIds(rubric);
  const registered = registeredAssertionIds();
  const duplicate = declared.filter((id, index) => declared.indexOf(id) !== index);
  const missing = declared.filter(id => !registered.includes(id));
  const undeclared = registered.filter(id => !declared.includes(id));
  if (duplicate.length || missing.length || undeclared.length) {
    throw new Error(`AInvest Heatmap rubric/check mismatch: ${JSON.stringify({ duplicate, missing, undeclared })}`);
  }
  for (const id of rubric.hard_gates || []) {
    if (!declared.includes(id)) throw new Error(`Hard gate "${id}" is not a rubric check.`);
  }
  return {
    declared: [...declared].sort(),
    registered,
    hardGates: [...(rubric.hard_gates || [])],
  };
}

function validateObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('AInvest Heatmap observation must be an object.');
  }
  // `commands` is the only section both producer shapes guarantee: golden
  // observations (hidden control re-executed) additionally carry the
  // case-specific sections, while real-run collector observations are
  // conservative. Section-level assertions treat missing sections as not proven.
  if (!observation.commands || typeof observation.commands !== 'object') {
    throw new TypeError('AInvest Heatmap observation is missing "commands".');
  }
}

export {
  AREA_SHARE_TOLERANCE,
  COLOR_POSITION_TOLERANCE,
  areaShareFailures,
  colorMappingFailures,
  expectedColorPosition,
} from './math.mjs';
export { businessStatesEqual, canonicalBusinessState } from './state.mjs';
