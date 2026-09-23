import { join } from 'node:path';

import { evaluateAinvestHeatmap } from '../evaluators/cases/ainvest-heatmap/index.mjs';
import { evaluateMacroMap3d } from '../evaluators/cases/macro-map-3d/index.mjs';
import { evaluateNarrativeEquity } from '../evaluators/cases/narrative-equity/index.mjs';
import { evaluateStandardChartTwoWayTree } from '../evaluators/cases/standard-chart-two-way-tree/index.mjs';
import { evaluateMemoryEffectivenessSmoke } from '../evaluators/cases/memory-effectiveness-smoke/index.mjs';

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
    suiteRole: 'primary',
  },
  'narrative-equity-relationship': {
    evaluator: evaluateNarrativeEquity,
    starter: 'cases/narrative-equity-relationship/fixture/starter',
    plan: 'cases/narrative-equity-relationship/fixture/plan.yaml',
    testSample: 'equity',
    suiteRole: 'primary',
  },
  'ainvest-market-heatmap-rebuild': {
    evaluator: evaluateAinvestHeatmap,
    starter: 'cases/ainvest-market-heatmap-rebuild/fixture/starter',
    plan: 'cases/ainvest-market-heatmap-rebuild/fixture/plan.yaml',
    testSample: 'heatmap',
    suiteRole: 'primary',
  },
  // Backup cases: not part of PRIMARY_CASES so they never enter the default
  // bench pipeline automatically. Registered so operators can target them
  // explicitly via getCaseRuntime().
  'standard-chart-two-way-tree': {
    evaluator: evaluateStandardChartTwoWayTree,
    starter: 'cases/standard-chart-two-way-tree/fixture/starter',
    plan: 'cases/standard-chart-two-way-tree/fixture/plan.yaml',
    testSample: 'two-way-tree',
    suiteRole: 'backup',
  },
  'memory-effectiveness-smoke': {
    evaluator: evaluateMemoryEffectivenessSmoke,
    starter: 'cases/memory-effectiveness-smoke/fixture/starter',
    plan: 'cases/memory-effectiveness-smoke/fixture/plan.yaml',
    testSample: 'memory-effectiveness',
    suiteRole: 'backup',
  },
  'radar-radius-override-bugfix': {
    evaluator: async (options = {}) => {
      const { runHiddenEvaluator } = await import('../../cases/radar-radius-override-bugfix/evaluator/test-suite.mjs');
      const raw = await runHiddenEvaluator(options.workspace || process.cwd());
      const passed = raw.details ? raw.details.filter(d => d.passed).length : 0;
      const total = raw.details ? raw.details.length : 1;
      const score = total > 0 ? Math.round((passed / total) * 100) : (raw.status === 'success' ? 100 : 0);
      return {
        status: raw.status,
        summary: raw.summary,
        scorecard: { total: score, details: raw.details || [] },
        evidence_trust: { status: 'attested', level: 'high' },
        details: raw.details,
        next_actions: raw.next_actions || [],
        artifacts: raw.artifacts || [],
      };
    },
    starter: 'cases/radar-radius-override-bugfix/fixture',
    plan: 'cases/radar-radius-override-bugfix/scenario/stages.yaml',
    testSample: 'radar-radius-bugfix',
    suiteRole: 'backup',
  },
  'compare-bubble-adaptive-placement': {
    evaluator: async (options = {}) => {
      const { runHiddenEvaluator } = await import('../../cases/compare-bubble-adaptive-placement/evaluator/test-suite.mjs');
      const raw = await runHiddenEvaluator(options.workspace || process.cwd());
      const passed = raw.details ? raw.details.filter(d => d.passed).length : 0;
      const total = raw.details ? raw.details.length : 1;
      const score = total > 0 ? Math.round((passed / total) * 100) : (raw.status === 'success' ? 100 : 0);
      return {
        status: raw.status,
        summary: raw.summary,
        scorecard: { total: score, details: raw.details || [] },
        evidence_trust: { status: 'attested', level: 'high' },
        details: raw.details,
        next_actions: raw.next_actions || [],
        artifacts: raw.artifacts || [],
      };
    },
    starter: 'cases/compare-bubble-adaptive-placement/fixture',
    plan: 'cases/compare-bubble-adaptive-placement/scenario/stages.yaml',
    testSample: 'compare-bubble-placement',
    suiteRole: 'backup',
  },
  '3d-globe-backface-occlusion': {
    evaluator: async (options = {}) => {
      const { runHiddenEvaluator } = await import('../../cases/3d-globe-backface-occlusion/evaluator/test-suite.mjs');
      const raw = await runHiddenEvaluator(options.workspace || process.cwd());
      const passed = raw.details ? raw.details.filter(d => d.passed).length : 0;
      const total = raw.details ? raw.details.length : 1;
      const score = total > 0 ? Math.round((passed / total) * 100) : (raw.status === 'success' ? 100 : 0);
      return {
        status: raw.status,
        summary: raw.summary,
        scorecard: { total: score, details: raw.details || [] },
        evidence_trust: { status: 'attested', level: 'high' },
        details: raw.details,
        next_actions: raw.next_actions || [],
        artifacts: raw.artifacts || [],
      };
    },
    starter: 'cases/3d-globe-backface-occlusion/fixture',
    plan: 'cases/3d-globe-backface-occlusion/scenario/stages.yaml',
    testSample: '3d-globe-occlusion',
    suiteRole: 'backup',
  },
});

export function getCaseRuntime(projectRoot, caseId) {
  const entry = CASES[caseId];
  if (!entry) throw new Error(`No executable Case registered for ${caseId}.`);
  return {
    ...entry,
    caseId,
    starter: join(projectRoot, entry.starter),
    plan: join(projectRoot, entry.plan),
    caseDir: join(projectRoot, 'cases', caseId),
  };
}
