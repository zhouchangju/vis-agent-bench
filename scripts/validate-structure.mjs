import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const requiredFiles = [
  'README.md',
  'AGENTS.md',
  'docs/product/PRD.md',
  'docs/architecture/ARCHITECTURE.md',
  'docs/architecture/ISOLATION_AND_ANTI_CHEATING.md',
  'docs/architecture/RUNNER_PROTOCOL.md',
  'docs/design/REQUIREMENT_GRANULARITY.md',
  'docs/design/ITERATIVE_REQUIREMENT_LOOP.md',
  'docs/design/EFFICIENCY_EVALUATION.md',
  'docs/design/RUN_LOG_SPEC.md',
  'docs/design/HUMAN_REVIEW_WORKFLOW.md',
  'docs/candidates/README.md',
  'docs/roadmap/ROADMAP.md',
  'prototype/setup.html',
  'prototype/review.html',
  'prototype/report.html',
  'schemas/human-review.schema.json',
];

const missing = requiredFiles.filter(file => !existsSync(resolve(root, file)));
const approvedCases = existsSync(resolve(root, 'cases'))
  ? readdirSync(resolve(root, 'cases'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  : [];

const caseErrors = [];
let primaryCaseCount = 0;
for (const caseId of approvedCases) {
  const caseRoot = resolve(root, 'cases', caseId);
  const caseFile = resolve(caseRoot, 'case.yaml');
  const stagesFile = resolve(caseRoot, 'scenario', 'stages.yaml');
  const initialBrief = resolve(caseRoot, 'scenario', 'initial-brief.md');
  for (const path of [caseFile, stagesFile, initialBrief]) {
    if (!existsSync(path)) caseErrors.push(`Missing ${path.slice(root.length + 1)}`);
  }
  if (!existsSync(stagesFile)) continue;
  try {
    const caseConfig = parseYaml(readFileSync(caseFile, 'utf8'));
    if (caseConfig.suite_role === 'primary') primaryCaseCount += 1;
    if (!['primary', 'backup'].includes(caseConfig.suite_role)) {
      caseErrors.push(`${caseId}: suite_role must be primary or backup`);
    }
    const scenario = parseYaml(readFileSync(stagesFile, 'utf8'));
    if (scenario.mode !== 'progressive-disclosure') {
      caseErrors.push(`${caseId}: scenario mode must be progressive-disclosure`);
    }
    if (!Array.isArray(scenario.stages) || scenario.stages.length < 3) {
      caseErrors.push(`${caseId}: scenario requires at least three stages`);
    }
  } catch (error) {
    caseErrors.push(`${caseId}: invalid scenario YAML: ${error.message}`);
  }
}
if (primaryCaseCount !== 3) {
  caseErrors.push(`Expected 3 primary cases, found ${primaryCaseCount}`);
}

const result = {
  status: missing.length === 0 && caseErrors.length === 0 ? 'success' : 'error',
  summary:
    missing.length === 0 && caseErrors.length === 0
      ? `Repository structure is valid; ${primaryCaseCount} primary and ${approvedCases.length - primaryCaseCount} backup case(s).`
      : `Repository structure has ${missing.length + caseErrors.length} issue(s).`,
  next_actions:
    missing.length === 0 && caseErrors.length === 0
      ? primaryCaseCount === 3
        ? ['Build sanitized fixtures and executable evaluators for the three primary cases.']
        : ['Keep the first suite limited to the three primary cases.']
      : [...missing.map(file => `Create ${file}`), ...caseErrors],
  artifacts: requiredFiles.filter(file => existsSync(resolve(root, file))),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (missing.length > 0 || caseErrors.length > 0) process.exitCode = 1;
