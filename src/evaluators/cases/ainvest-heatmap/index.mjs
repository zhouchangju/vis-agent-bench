import { readFileSync } from 'node:fs';

import { runEvaluation } from '../../core/index.mjs';
import { createAinvestHeatmapChecks, registeredAssertionIds } from './checks.mjs';
import { loadAinvestHeatmapRubric, rubricCheckIds } from './rubric.mjs';

export const AINVEST_HEATMAP_CASE_ID = 'ainvest-market-heatmap-rebuild';

export function createAinvestHeatmapEvaluator({
  observation,
  observationPath,
  rubric = loadAinvestHeatmapRubric(),
} = {}) {
  const resolvedObservation = observation || readObservation(observationPath);
  validateObservation(resolvedObservation);
  validateCheckMapping(rubric);

  return {
    caseId: AINVEST_HEATMAP_CASE_ID,
    rubric,
    checks: createAinvestHeatmapChecks(rubric),
    prepare() {
      return { observation: resolvedObservation };
    },
    notes: [
      'Deterministic data, behavior, state, and accessibility proxies only.',
      'Real-browser observations do not prove aesthetics, visual parity, or cross-browser quality.',
    ].join(' '),
  };
}

export async function evaluateAinvestHeatmap(options = {}) {
  const observation = options.observation || readObservation(options.observationPath);
  const evaluator = createAinvestHeatmapEvaluator({ ...options, observation });
  return runEvaluation(evaluator, {
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

function readObservation(path) {
  if (!path) throw new TypeError('createAinvestHeatmapEvaluator requires observation or observationPath.');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('AInvest Heatmap observation must be an object.');
  }
  for (const key of [
    'commands',
    'input',
    'area',
    'layout',
    'color',
    'legend',
    'tooltip',
    'labels',
    'browserEvidence',
    'interactions',
    'state',
    'accessibility',
    'responsive',
    'performance',
    'engineering',
  ]) {
    if (!observation[key] || typeof observation[key] !== 'object') {
      throw new TypeError(`AInvest Heatmap observation is missing "${key}".`);
    }
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
