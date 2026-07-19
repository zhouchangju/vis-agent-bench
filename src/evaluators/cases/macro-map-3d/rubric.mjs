import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUBRIC_PATH = resolve(
  HERE,
  '../../../../cases/macro-map-3d-greenfield/evaluator/deterministic-rubric.yaml',
);
const CASE_ROOT = resolve(HERE, '../../../../cases/macro-map-3d-greenfield');

export const DEFAULT_CONTROL_INPUTS = Object.freeze({
  graph200: resolve(CASE_ROOT, 'fixture/starter/data/public/graph-200.json'),
  graph800: resolve(CASE_ROOT, 'fixture/starter/data/public/graph-800.json'),
  graph1481: resolve(CASE_ROOT, 'fixture/starter/data/public/graph-1481.json'),
  boundary: resolve(CASE_ROOT, 'fixture/starter/data/public/boundary-valid.json'),
  invalid: resolve(CASE_ROOT, 'fixture/control/invalid-inputs.json'),
});

export function loadMacroMap3dRubric(path = DEFAULT_RUBRIC_PATH) {
  const rubric = parse(readFileSync(path, 'utf8'));
  if (rubric?.version !== 1 || rubric?.total !== 100 || !rubric?.categories) {
    throw new Error(`Invalid macro-map-3d rubric at ${path}.`);
  }
  const weight = Object.values(rubric.categories)
    .reduce((sum, category) => sum + category.weight, 0);
  if (weight !== 100) throw new Error(`Macro Map 3D rubric weights total ${weight}, expected 100.`);
  return rubric;
}

export function rubricCheckIds(rubric) {
  return Object.values(rubric.categories).flatMap(category => category.checks || []);
}
