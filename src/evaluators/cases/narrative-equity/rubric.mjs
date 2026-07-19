import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUBRIC_PATH = resolve(
  HERE,
  '../../../../cases/narrative-equity-relationship/evaluator/rubric.yaml',
);
const CASE_ROOT = resolve(HERE, '../../../../cases/narrative-equity-relationship');

export const DEFAULT_CONTROL_INPUTS = Object.freeze({
  valid: resolve(CASE_ROOT, 'fixture/starter/data/public/valid-input.json'),
  boundary: resolve(CASE_ROOT, 'fixture/starter/data/public/boundary-input.json'),
  invalid: resolve(CASE_ROOT, 'fixture/control/invalid-input.json'),
});

export function loadNarrativeEquityRubric(path = DEFAULT_RUBRIC_PATH) {
  const rubric = parse(readFileSync(path, 'utf8'));
  if (rubric?.version !== 1 || rubric?.total !== 100 || !rubric?.categories) {
    throw new Error(`Invalid narrative-equity rubric at ${path}.`);
  }
  return rubric;
}

export function rubricCheckIds(rubric) {
  return Object.values(rubric.categories).flatMap(category => category.checks || []);
}
