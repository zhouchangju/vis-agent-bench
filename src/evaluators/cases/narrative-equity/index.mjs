import { runEvaluation } from '../../core/index.mjs';
import {
  annotateEvaluationTrust,
  resolveObservationInput,
} from '../../control/observation-attestation.mjs';
import { createNarrativeEquityChecks, registeredAssertionIds } from './checks.mjs';
import { DEFAULT_CONTROL_INPUTS, loadNarrativeEquityRubric, rubricCheckIds } from './rubric.mjs';

export const NARRATIVE_EQUITY_CASE_ID = 'narrative-equity-relationship';

export function createNarrativeEquityEvaluator({
  observation,
  observationPath,
  attestationPath,
  runRoot,
  runId,
  allowTestDouble = false,
  rubric = loadNarrativeEquityRubric(),
  controlInputs = DEFAULT_CONTROL_INPUTS,
} = {}) {
  const resolved = resolveObservationInput({
    caseId: NARRATIVE_EQUITY_CASE_ID,
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
    caseId: NARRATIVE_EQUITY_CASE_ID,
    rubric,
    checks: createNarrativeEquityChecks(rubric),
    controlInputs,
    prepare() {
      return { observation: resolvedObservation, controlInputs };
    },
    evidenceTrust: resolved.trust,
    notes: 'Deterministic proxies only; subjective visual quality requires VAB-T06 human review.',
  };
}

export async function evaluateNarrativeEquity(options = {}) {
  const evaluator = createNarrativeEquityEvaluator(options);
  const evaluation = await runEvaluation(evaluator, {
    runId: options.runId,
    workspace: options.workspace,
    logsDir: options.logsDir,
    runTimeoutMs: options.runTimeoutMs,
    scoring: {
      capTriggers: {
        hardcoded_fixture_answer_max_score: options.hardcodedFixtureAnswer === true,
        missing_group_animation_max_score: options.missingGroupAnimation === true,
        non_deterministic_navigation_max_score: options.nonDeterministicNavigation === true,
      },
    },
  });
  return annotateEvaluationTrust(evaluation, evaluator.evidenceTrust);
}

export function validateCheckMapping(rubric = loadNarrativeEquityRubric()) {
  const declared = rubricCheckIds(rubric).sort();
  const registered = registeredAssertionIds();
  const missing = declared.filter(id => !registered.includes(id));
  const undeclared = registered.filter(id => !declared.includes(id));
  const duplicate = declared.filter((id, index) => declared.indexOf(id) !== index);
  if (missing.length || undeclared.length || duplicate.length) {
    throw new Error(`Narrative equity rubric/check mismatch: ${JSON.stringify({ missing, undeclared, duplicate })}`);
  }
  for (const id of rubric.hard_gates || []) {
    if (!declared.includes(id)) throw new Error(`Hard gate "${id}" is not a rubric check.`);
  }
  return { declared, hardGates: [...(rubric.hard_gates || [])] };
}

function validateObservation(observation) {
  if (!observation || typeof observation !== 'object') {
    throw new TypeError('Narrative equity observation must be an object.');
  }
  // `commands` is the only section both producer shapes guarantee:
  // golden observations (hidden control re-executed) additionally carry
  // overview/events/states/behavior, while real-run collector observations are
  // conservative. Section-level assertions treat missing sections as not proven.
  if (!observation.commands || typeof observation.commands !== 'object') {
    throw new TypeError('Narrative equity observation is missing "commands".');
  }
}

export {
  GEOMETRY_TOLERANCE,
  edgeNodeIntersections,
  endpointBoundaryFailures,
  overlapRatio,
  severeNodeOverlaps,
} from './geometry.mjs';
export { canonicalState, statesEqual } from './state.mjs';
export { DEFAULT_CONTROL_INPUTS } from './rubric.mjs';
