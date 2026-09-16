import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRepositoryContracts } from '../src/contracts/index.mjs';

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
  'config/privacy/transfer-scan-profile.json',
];

const missing = requiredFiles.filter(file => !existsSync(resolve(root, file)));

// JSON-tracked configs must stay parseable (they gate transfers and reviews).
const jsonFiles = [
  'config/privacy/transfer-scan-profile.json',
  'schemas/human-review.schema.json',
];
const jsonErrors = [];
for (const file of jsonFiles) {
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  try {
    JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    jsonErrors.push(`${file}: invalid JSON — ${error.message}`);
  }
}

const contract = validateRepositoryContracts(root);
const contractErrors = contract.errors.map(error => `${error.path}: ${error.code} — ${error.message}`);

const issueCount = missing.length + jsonErrors.length + contractErrors.length;
const result = {
  status: issueCount === 0 ? 'success' : 'error',
  summary:
    issueCount === 0
      ? `Repository structure and contracts are valid. ${contract.result.summary}`
      : `Repository structure has ${issueCount} issue(s).`,
  next_actions:
    issueCount === 0
      ? contract.result.next_actions
      : [...missing.map(file => `Create ${file}`), ...jsonErrors, ...contractErrors],
  artifacts: [...requiredFiles.filter(file => existsSync(resolve(root, file))), ...(contract.result.artifacts || [])],
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (issueCount > 0) process.exitCode = 1;
