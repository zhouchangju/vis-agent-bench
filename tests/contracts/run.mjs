import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  validateCaseConfig,
  validateRepositoryContracts,
  validateResultEnvelope,
  validateRubric,
  validateRunSpec,
  validateScenario,
} from '../../src/contracts/index.mjs';
import {
  HUMAN_REVIEW_REQUIRED_TOP,
  HUMAN_REVIEW_REVIEW_REQUIRED,
} from '../../src/review/human-review-package.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const schemaFiles = [
  'case.schema.json',
  'scenario.schema.json',
  'run-spec.schema.json',
  'result-envelope.schema.json',
  'rubric.schema.json',
  'memory-experiment-spec.schema.json',
  'memory-intervention.schema.json',
  'memory-feedback.schema.json',
  'memory-paired-report.schema.json',
  'human-review.schema.json',
];

function readYaml(path) {
  return parseYaml(readFileSync(resolve(root, path), 'utf8'));
}

function codes(result) {
  return result.errors.map(error => error.code);
}

function expectInvalid(result, code) {
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes(code), `Expected ${code}; received ${codes(result).join(', ')}`);
  assert.equal(result.result.status, 'error');
  assert.ok(result.result.error?.safe_retry);
}

const checks = [
  ['JSON schemas parse and identify themselves', () => {
    for (const file of schemaFiles) {
      const schema = JSON.parse(readFileSync(resolve(root, 'schemas', file), 'utf8'));
      assert.ok(schema.$id?.includes(file));
    }
  }],
  ['human-review schema required fields match the runtime validator mirror', () => {
    const schema = JSON.parse(readFileSync(resolve(root, 'schemas', 'human-review.schema.json'), 'utf8'));
    assert.deepEqual([...schema.required].sort(), [...HUMAN_REVIEW_REQUIRED_TOP].sort());
    const reviewItem = schema.properties.reviews.items;
    assert.deepEqual([...reviewItem.required].sort(), [...HUMAN_REVIEW_REVIEW_REQUIRED].sort());
    // The schema allows exactly the fields the runtime validator accepts.
    assert.deepEqual(
      Object.keys(reviewItem.properties).sort(),
      [...HUMAN_REVIEW_REVIEW_REQUIRED, 'machine_evidence'].sort(),
    );
  }],
  ['all current cases and the example RunSpec are valid', () => {
    const result = validateRepositoryContracts(root);
    assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  }],
  ['case rejects an invalid suite role', () => {
    const value = structuredClone(readYaml('cases/macro-map-3d-greenfield/case.yaml'));
    value.suite_role = 'experimental';
    expectInvalid(validateCaseConfig(value, { expectedId: 'macro-map-3d-greenfield' }), 'ENUM');
  }],
  ['scenario rejects duplicate stage IDs', () => {
    const value = structuredClone(readYaml('cases/macro-map-3d-greenfield/scenario/stages.yaml'));
    value.stages[1].id = 'S0';
    expectInvalid(validateScenario(value), 'STAGE_ORDER');
    assert.ok(codes(validateScenario(value)).includes('DUPLICATE_STAGE'));
  }],
  ['scenario rejects a future stage input leak', () => {
    const value = structuredClone(readYaml('cases/macro-map-3d-greenfield/scenario/stages.yaml'));
    value.stages[1].input = 'future-details.md';
    expectInvalid(validateScenario(value), 'FUTURE_STAGE_INPUT');
  }],
  ['rubric rejects weights that do not total 100', () => {
    const value = structuredClone(readYaml('cases/macro-map-3d-greenfield/evaluator/rubric.yaml'));
    value.weights.business_correctness = 21;
    expectInvalid(validateRubric(value), 'WEIGHT_TOTAL');
  }],
  ['RunSpec rejects answer repository access before a run starts', () => {
    const value = structuredClone(readYaml('config/run-profile.example.yaml'));
    value.permissions.read_answer_repository = true;
    expectInvalid(validateRunSpec(value), 'FORBIDDEN_ACCESS');
  }],
  ['RunSpec rejects Codex-only reasoning effort on other adapters', () => {
    const value = structuredClone(readYaml('config/run-profile.example.yaml'));
    value.engine.adapter = 'kimi';
    value.engine.reasoning_effort = 'xhigh';
    expectInvalid(validateRunSpec(value), 'ENGINE_OPTION_UNSUPPORTED');
  }],
  ['RunSpec accepts Claude Code reasoning effort within low/medium/high', () => {
    const value = structuredClone(readYaml('config/run-profile.example.yaml'));
    value.engine.adapter = 'claude';
    value.engine.reasoning_effort = 'high';
    value.budget.max_cost_usd = 2;
    assert.equal(validateRunSpec(value).valid, true);
    value.engine.reasoning_effort = 'xhigh';
    expectInvalid(validateRunSpec(value), 'ENUM');
  }],
  ['RunSpec accepts OpenCode reasoning effort and rejects invalid effort', () => {
    const value = structuredClone(readYaml('config/models/opencode-zai-glm-5.3-high.yaml'));
    assert.equal(validateRunSpec(value).valid, true);
    value.engine.reasoning_effort = 'max';
    assert.equal(validateRunSpec(value).valid, true);
    value.engine.reasoning_effort = 'ultra';
    expectInvalid(validateRunSpec(value), 'ENUM');
  }],
  ['RunSpec accepts Codex reasoning effort including max', () => {
    const value = structuredClone(readYaml('config/models/codex-gpt-5.6-luna-max.yaml'));
    assert.equal(validateRunSpec(value).valid, true);
  }],
  ['every model profile under config/models/ is a valid RunSpec', () => {
    const result = validateRepositoryContracts(root);
    assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
    assert.ok(result.result.artifacts.some(path => path.startsWith('config/models/')));
  }],
  ['RunSpec accepts Pi model provider only for the Pi adapter', () => {
    const value = structuredClone(readYaml('config/run-profile.example.yaml'));
    value.engine.adapter = 'pi';
    value.engine.reasoning_effort = null;
    value.engine.model_provider = 'deepseek';
    assert.equal(validateRunSpec(value).valid, true);
    value.engine.adapter = 'claude';
    expectInvalid(validateRunSpec(value), 'ENGINE_OPTION_UNSUPPORTED');
  }],
  ['error result requires an actionable recovery contract', () => {
    expectInvalid(validateResultEnvelope({ status: 'error', summary: 'failed', next_actions: [], artifacts: [] }), 'REQUIRED');
  }],
];

const failures = [];
for (const [name, check] of checks) {
  try {
    check();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.message });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  }
}

process.stdout.write(`${JSON.stringify({ status: failures.length ? 'error' : 'success', summary: `${checks.length - failures.length}/${checks.length} contract checks passed.`, next_actions: failures.length ? ['Fix failed contract checks.'] : [], artifacts: ['tests/contracts/run.mjs'], ...(failures.length ? { failures } : {}) }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
