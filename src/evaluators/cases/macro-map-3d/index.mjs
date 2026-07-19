import { readFileSync } from 'node:fs';

import { runEvaluation } from '../../core/index.mjs';
import { createMacroMap3dChecks, registeredAssertionIds } from './checks.mjs';
import { DEFAULT_CONTROL_INPUTS, loadMacroMap3dRubric, rubricCheckIds } from './rubric.mjs';

export const MACRO_MAP_3D_CASE_ID = 'macro-map-3d-greenfield';

export function createMacroMap3dEvaluator({
  observation,
  observationPath,
  rubric = loadMacroMap3dRubric(),
  controlInputs = DEFAULT_CONTROL_INPUTS,
} = {}) {
  const resolvedObservation = observation || readObservation(observationPath);
  validateObservation(resolvedObservation);
  validateCheckMapping(rubric);

  return {
    caseId: MACRO_MAP_3D_CASE_ID,
    rubric,
    checks: createMacroMap3dChecks(rubric),
    controlInputs,
    prepare() {
      return { observation: resolvedObservation, controlInputs };
    },
    notes: [
      'Real-browser evidence proves declared behavior/state only.',
      'Screenshots and Canvas signatures do not prove aesthetics or WebGL correctness.',
      'Spatial hierarchy, camera comfort, animation feel, and label aesthetics require human review.',
    ].join(' '),
  };
}

export async function evaluateMacroMap3d(options = {}) {
  return runEvaluation(createMacroMap3dEvaluator(options), {
    runId: options.runId,
    workspace: options.workspace,
    logsDir: options.logsDir,
    runTimeoutMs: options.runTimeoutMs,
  });
}

export function validateCheckMapping(rubric = loadMacroMap3dRubric()) {
  const declared = rubricCheckIds(rubric).sort();
  const registered = registeredAssertionIds();
  const missing = declared.filter(id => !registered.includes(id));
  const undeclared = registered.filter(id => !declared.includes(id));
  const duplicate = declared.filter((id, index) => declared.indexOf(id) !== index);
  if (missing.length || undeclared.length || duplicate.length) {
    throw new Error(`Macro Map 3D rubric/check mismatch: ${JSON.stringify({ missing, undeclared, duplicate })}`);
  }
  for (const id of rubric.hard_gates || []) {
    if (!declared.includes(id)) throw new Error(`Hard gate "${id}" is not a rubric check.`);
  }
  return { declared, hardGates: [...(rubric.hard_gates || [])] };
}

function readObservation(path) {
  if (!path) throw new TypeError('createMacroMap3dEvaluator requires observation or observationPath.');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateObservation(observation) {
  if (!observation || typeof observation !== 'object') {
    throw new TypeError('Macro Map 3D observation must be an object.');
  }
  for (const key of [
    'commands', 'inputs', 'datasets', 'layout', 'render', 'browser', 'camera',
    'interactions', 'selection', 'runtime', 'resize', 'fallback', 'performance',
    'lifecycle', 'engineering', 'proof_boundary',
  ]) {
    const value = observation[key];
    if (value == null || typeof value !== 'object') {
      throw new TypeError(`Macro Map 3D observation is missing "${key}".`);
    }
  }
}

export { DEFAULT_CONTROL_INPUTS } from './rubric.mjs';
