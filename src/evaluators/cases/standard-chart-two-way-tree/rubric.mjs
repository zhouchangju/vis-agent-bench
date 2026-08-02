import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUBRIC_PATH = resolve(
  HERE,
  '../../../../cases/standard-chart-two-way-tree/evaluator/rubric.yaml',
);

export function loadStandardChartRubric(path = DEFAULT_RUBRIC_PATH) {
  const rubric = parse(readFileSync(path, 'utf8'));
  if (rubric?.version !== 1 || rubric?.total !== 100 || !rubric?.categories) {
    throw new Error(`Invalid StandardChart two-way-tree rubric at ${path}.`);
  }
  const weight = Object.values(rubric.categories)
    .reduce((sum, category) => sum + (Number(category.weight) || 0), 0);
  if (weight !== 100) {
    throw new Error(`StandardChart two-way-tree rubric weights total ${weight}, expected 100.`);
  }
  return rubric;
}

export function rubricCheckIds(rubric) {
  return Object.values(rubric.categories).flatMap(category => category.checks || []);
}
