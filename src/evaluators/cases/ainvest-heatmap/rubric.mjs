import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUBRIC_PATH = resolve(
  HERE,
  '../../../../cases/ainvest-market-heatmap-rebuild/evaluator/rubric.yaml',
);

export function loadAinvestHeatmapRubric(path = DEFAULT_RUBRIC_PATH) {
  const rubric = parse(readFileSync(path, 'utf8'));
  if (rubric?.version !== 1 || rubric?.total !== 100 || !rubric?.categories) {
    throw new Error(`Invalid AInvest Heatmap rubric at ${path}.`);
  }
  return rubric;
}

export function rubricCheckIds(rubric) {
  return Object.values(rubric.categories).flatMap(category => category.checks || []);
}
