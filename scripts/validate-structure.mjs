import { existsSync } from 'node:fs';
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
];

const missing = requiredFiles.filter(file => !existsSync(resolve(root, file)));
const contract = validateRepositoryContracts(root);
const contractErrors = contract.errors.map(error => `${error.path}: ${error.code} — ${error.message}`);

const result = {
  status: missing.length === 0 && contractErrors.length === 0 ? 'success' : 'error',
  summary:
    missing.length === 0 && contractErrors.length === 0
      ? `Repository structure and contracts are valid. ${contract.result.summary}`
      : `Repository structure has ${missing.length + contractErrors.length} issue(s).`,
  next_actions:
    missing.length === 0 && contractErrors.length === 0
      ? contract.result.next_actions
      : [...missing.map(file => `Create ${file}`), ...contractErrors],
  artifacts: [...requiredFiles.filter(file => existsSync(resolve(root, file))), ...(contract.result.artifacts || [])],
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (missing.length > 0 || contractErrors.length > 0) process.exitCode = 1;
