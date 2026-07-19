import { join } from 'node:path';

import { evaluateAinvestHeatmap } from '../evaluators/cases/ainvest-heatmap/index.mjs';
import { evaluateMacroMap3d } from '../evaluators/cases/macro-map-3d/index.mjs';
import { evaluateNarrativeEquity } from '../evaluators/cases/narrative-equity/index.mjs';

export const PRIMARY_CASES = Object.freeze([
  'macro-map-3d-greenfield',
  'narrative-equity-relationship',
  'ainvest-market-heatmap-rebuild',
]);

const CASES = Object.freeze({
  'macro-map-3d-greenfield': {
    evaluator: evaluateMacroMap3d,
    starter: 'cases/macro-map-3d-greenfield/fixture/starter',
    plan: 'cases/macro-map-3d-greenfield/fixture/plan.yaml',
    testSample: 'macro',
  },
  'narrative-equity-relationship': {
    evaluator: evaluateNarrativeEquity,
    starter: 'cases/narrative-equity-relationship/fixture/starter',
    plan: 'cases/narrative-equity-relationship/fixture/plan.yaml',
    testSample: 'equity',
  },
  'ainvest-market-heatmap-rebuild': {
    evaluator: evaluateAinvestHeatmap,
    starter: 'cases/ainvest-market-heatmap-rebuild/fixture/starter',
    plan: 'cases/ainvest-market-heatmap-rebuild/fixture/plan.yaml',
    testSample: 'heatmap',
  },
});

export function getCaseRuntime(projectRoot, caseId) {
  const entry = CASES[caseId];
  if (!entry) throw new Error(`No executable primary Case registered for ${caseId}.`);
  return {
    ...entry,
    caseId,
    starter: join(projectRoot, entry.starter),
    plan: join(projectRoot, entry.plan),
    caseDir: join(projectRoot, 'cases', caseId),
  };
}
