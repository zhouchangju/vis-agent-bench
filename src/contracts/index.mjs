import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const CASE_STATUS = new Set(['draft', 'active', 'backup', 'retired']);
const SUITE_ROLES = new Set(['primary', 'backup']);
const SOURCE_TYPES = new Set(['observed', 'inferred', 'proposed']);
const DIFFICULTIES = new Set(['basic', 'intermediate', 'advanced', 'expert']);
const ADAPTERS = new Set(['codex', 'kimi', 'claude', 'codex-cli', 'kimi-code-cli', 'claude-code-cli']);
const RESULT_STATUSES = new Set(['success', 'warning', 'error']);

function diagnostic(path, code, message) {
  return { path, code, message };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRelativePath(value) {
  return isNonEmptyString(value) && !isAbsolute(value);
}

function requireFields(value, fields, path, errors) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) errors.push(diagnostic(`${path}.${field}`, 'REQUIRED', 'Field is required.'));
  }
}

function validateStringArray(value, path, errors, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.some(item => !isNonEmptyString(item))) {
    errors.push(diagnostic(path, 'STRING_ARRAY', `Expected an array of at least ${min} non-empty strings.`));
  }
}

function validateNumber(value, path, errors, { min = 0, max = Infinity, integer = false, exclusiveMin = false } = {}) {
  const valid = typeof value === 'number'
    && Number.isFinite(value)
    && (exclusiveMin ? value > min : value >= min)
    && value <= max
    && (!integer || Number.isInteger(value));
  if (!valid) errors.push(diagnostic(path, 'NUMBER_RANGE', `Expected ${integer ? 'integer' : 'number'} in range.`));
}

function validateNoUnexpectedFields(value, allowed, path, errors) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(diagnostic(`${path}.${field}`, 'UNEXPECTED_FIELD', 'Field is not allowed by this contract.'));
  }
}

function validErrorResult(errors, artifacts = []) {
  return {
    valid: false,
    errors,
    result: createResultEnvelope({
      status: 'error',
      summary: `Contract validation failed with ${errors.length} issue(s).`,
      next_actions: ['Correct the reported paths before starting a model run.'],
      artifacts,
      error: {
        root_cause_hint: errors[0]?.message || 'Invalid contract input.',
        safe_retry: 'Fix the contract input and rerun validation.',
        stop_condition: 'Do not prepare or run a benchmark until validation succeeds.',
      },
    }),
  };
}

export function createResultEnvelope({ status, summary, next_actions = [], artifacts = [], error, ...extra }) {
  return { status, summary, next_actions, artifacts, ...(error ? { error } : {}), ...extra };
}

export function validateResultEnvelope(value) {
  const errors = [];
  if (!isObject(value)) return validErrorResult([diagnostic('$', 'OBJECT', 'Result envelope must be an object.')]);
  if (!RESULT_STATUSES.has(value.status)) errors.push(diagnostic('status', 'ENUM', 'status must be success, warning, or error.'));
  if (!isNonEmptyString(value.summary)) errors.push(diagnostic('summary', 'STRING', 'summary must be non-empty.'));
  validateStringArray(value.next_actions, 'next_actions', errors);
  validateStringArray(value.artifacts, 'artifacts', errors);
  if (value.status === 'error') {
    if (!isObject(value.error)) errors.push(diagnostic('error', 'REQUIRED', 'Error results require error recovery metadata.'));
    else {
      for (const field of ['root_cause_hint', 'safe_retry', 'stop_condition']) {
        if (!isNonEmptyString(value.error[field])) errors.push(diagnostic(`error.${field}`, 'STRING', 'Error recovery field must be non-empty.'));
      }
    }
  }
  return errors.length ? validErrorResult(errors) : { valid: true, errors: [], result: value };
}

export function validateCaseConfig(value, { expectedId } = {}) {
  const errors = [];
  if (!isObject(value)) return validErrorResult([diagnostic('$', 'OBJECT', 'Case config must be an object.')]);
  const required = ['id', 'title', 'status', 'suite_role', 'source_type', 'difficulty', 'task_type', 'visibility', 'initial_prompt', 'scenario', 'requirement_truth', 'clarifications', 'acceptance', 'rubric', 'fixture', 'provenance', 'quality_gate'];
  requireFields(value, required, '$', errors);
  validateNoUnexpectedFields(value, new Set([...required, 'source_analysis']), '$', errors);
  if (!isNonEmptyString(value.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id || '')) errors.push(diagnostic('$.id', 'CASE_ID', 'id must be kebab-case.'));
  if (expectedId && value.id !== expectedId) errors.push(diagnostic('$.id', 'CASE_ID_MISMATCH', `id must match case directory ${expectedId}.`));
  if (!isNonEmptyString(value.title)) errors.push(diagnostic('$.title', 'STRING', 'title must be non-empty.'));
  if (!CASE_STATUS.has(value.status)) errors.push(diagnostic('$.status', 'ENUM', 'status is invalid.'));
  if (!SUITE_ROLES.has(value.suite_role)) errors.push(diagnostic('$.suite_role', 'ENUM', 'suite_role must be primary or backup.'));
  if (!SOURCE_TYPES.has(value.source_type)) errors.push(diagnostic('$.source_type', 'ENUM', 'source_type is invalid.'));
  if (!DIFFICULTIES.has(value.difficulty)) errors.push(diagnostic('$.difficulty', 'ENUM', 'difficulty is invalid.'));
  if (!isNonEmptyString(value.task_type)) errors.push(diagnostic('$.task_type', 'STRING', 'task_type must be non-empty.'));
  if (!['internal', 'restricted', 'public'].includes(value.visibility)) errors.push(diagnostic('$.visibility', 'ENUM', 'visibility is invalid.'));
  for (const field of ['initial_prompt', 'scenario', 'requirement_truth', 'clarifications', 'acceptance', 'rubric', 'fixture', 'provenance', 'source_analysis']) {
    if (value[field] != null && !isRelativePath(value[field])) errors.push(diagnostic(`$.${field}`, 'RELATIVE_PATH', 'Path must be relative and non-empty.'));
  }
  if (!isObject(value.quality_gate)) errors.push(diagnostic('$.quality_gate', 'OBJECT', 'quality_gate must be an object.'));
  else {
    validateNoUnexpectedFields(value.quality_gate, new Set(['p0_required', 'max_critical_failures']), '$.quality_gate', errors);
    if (typeof value.quality_gate.p0_required !== 'boolean') errors.push(diagnostic('$.quality_gate.p0_required', 'BOOLEAN', 'p0_required must be boolean.'));
    validateNumber(value.quality_gate.max_critical_failures, '$.quality_gate.max_critical_failures', errors, { integer: true });
  }
  return errors.length ? validErrorResult(errors) : { valid: true, errors: [], result: createResultEnvelope({ status: 'success', summary: `Case ${value.id} is valid.`, artifacts: [] }) };
}

export function validateScenario(value) {
  const errors = [];
  if (!isObject(value)) return validErrorResult([diagnostic('$', 'OBJECT', 'Scenario must be an object.')]);
  requireFields(value, ['version', 'mode', 'requirement_truth', 'stages'], '$', errors);
  validateNoUnexpectedFields(value, new Set(['version', 'mode', 'requirement_truth', 'stages']), '$', errors);
  if (value.version !== 1) errors.push(diagnostic('$.version', 'CONST', 'version must be 1.'));
  if (value.mode !== 'progressive-disclosure') errors.push(diagnostic('$.mode', 'CONST', 'mode must be progressive-disclosure.'));
  if (!isRelativePath(value.requirement_truth)) errors.push(diagnostic('$.requirement_truth', 'RELATIVE_PATH', 'requirement_truth must be relative.'));
  if (!Array.isArray(value.stages) || value.stages.length < 3) errors.push(diagnostic('$.stages', 'MIN_ITEMS', 'At least three stages are required.'));
  else {
    const ids = new Set();
    value.stages.forEach((stage, index) => {
      const path = `$.stages[${index}]`;
      if (!isObject(stage)) {
        errors.push(diagnostic(path, 'OBJECT', 'Stage must be an object.'));
        return;
      }
      validateNoUnexpectedFields(stage, new Set(['id', 'name', 'input', 'stakeholder_message', 'checkpoint', 'observe']), path, errors);
      requireFields(stage, ['id', 'name', 'checkpoint', 'observe'], path, errors);
      const expectedId = `S${index}`;
      if (stage.id !== expectedId) errors.push(diagnostic(`${path}.id`, 'STAGE_ORDER', `Stage id must be ${expectedId}.`));
      if (ids.has(stage.id)) errors.push(diagnostic(`${path}.id`, 'DUPLICATE_STAGE', `Stage id ${stage.id} is duplicated.`));
      ids.add(stage.id);
      if (!isNonEmptyString(stage.name)) errors.push(diagnostic(`${path}.name`, 'STRING', 'name must be non-empty.'));
      validateStringArray(stage.checkpoint, `${path}.checkpoint`, errors, { min: 1 });
      validateStringArray(stage.observe, `${path}.observe`, errors, { min: 1 });
      const hasInput = isNonEmptyString(stage.input);
      const hasMessage = isNonEmptyString(stage.stakeholder_message);
      if (index === 0 && (!hasInput || hasMessage)) errors.push(diagnostic(path, 'INITIAL_BRIEF_ONLY', 'S0 must expose only its initial input.'));
      if (index > 0 && (!hasMessage || hasInput)) errors.push(diagnostic(path, 'FUTURE_STAGE_INPUT', 'Later stages must expose only their own stakeholder message.'));
    });
  }
  return errors.length ? validErrorResult(errors) : { valid: true, errors: [], result: createResultEnvelope({ status: 'success', summary: `Scenario has ${value.stages.length} valid progressive stages.`, artifacts: [] }) };
}

export function validateRubric(value) {
  const errors = [];
  if (!isObject(value)) return validErrorResult([diagnostic('$', 'OBJECT', 'Rubric must be an object.')]);
  if (isObject(value.weights)) {
    validateNoUnexpectedFields(value, new Set(['weights', 'gates', 'levels']), '$', errors);
    if (Object.keys(value.weights).length < 2) errors.push(diagnostic('$.weights', 'MIN_PROPERTIES', 'At least two weights are required.'));
    let total = 0;
    for (const [key, weight] of Object.entries(value.weights)) {
      validateNumber(weight, `$.weights.${key}`, errors, { exclusiveMin: true });
      total += weight;
    }
    if (total !== 100) errors.push(diagnostic('$.weights', 'WEIGHT_TOTAL', 'Legacy rubric weights must total 100.'));
    if (!isObject(value.gates)) errors.push(diagnostic('$.gates', 'OBJECT', 'gates must be an object.'));
    else {
      requireFields(value.gates, ['p0_min_score', 'critical_failure_cap'], '$.gates', errors);
      validateNumber(value.gates.p0_min_score, '$.gates.p0_min_score', errors, { max: 100 });
      validateNumber(value.gates.critical_failure_cap, '$.gates.critical_failure_cap', errors, { max: 100 });
    }
    if (!isObject(value.levels) || !['p0', 'p1', 'p2'].every(level => isNonEmptyString(value.levels?.[level]))) errors.push(diagnostic('$.levels', 'LEVELS', 'levels must define p0, p1, and p2.'));
  } else {
    validateNoUnexpectedFields(value, new Set(['version', 'total', 'hard_gates', 'categories', 'caps']), '$', errors);
    if (value.version !== 1) errors.push(diagnostic('$.version', 'CONST', 'version must be 1.'));
    if (value.total !== 100) errors.push(diagnostic('$.total', 'CONST', 'total must be 100.'));
    validateStringArray(value.hard_gates, '$.hard_gates', errors, { min: 1 });
    if (!isObject(value.categories) || Object.keys(value.categories).length === 0) errors.push(diagnostic('$.categories', 'OBJECT', 'categories must be non-empty.'));
    else {
      let total = 0;
      for (const [key, category] of Object.entries(value.categories)) {
        if (!isObject(category)) {
          errors.push(diagnostic(`$.categories.${key}`, 'OBJECT', 'category must be an object.'));
          continue;
        }
        validateNoUnexpectedFields(category, new Set(['weight', 'checks']), `$.categories.${key}`, errors);
        validateNumber(category.weight, `$.categories.${key}.weight`, errors, { exclusiveMin: true });
        validateStringArray(category.checks, `$.categories.${key}.checks`, errors, { min: 1 });
        total += category.weight || 0;
      }
      if (total !== 100) errors.push(diagnostic('$.categories', 'WEIGHT_TOTAL', 'Category weights must total 100.'));
    }
    if (!isObject(value.caps) || Object.keys(value.caps).length === 0) errors.push(diagnostic('$.caps', 'OBJECT', 'caps must be non-empty.'));
    else for (const [key, cap] of Object.entries(value.caps)) validateNumber(cap, `$.caps.${key}`, errors, { max: 100 });
  }
  return errors.length ? validErrorResult(errors) : { valid: true, errors: [], result: createResultEnvelope({ status: 'success', summary: 'Rubric weights and gates are valid.', artifacts: [] }) };
}

export function validateRunSpec(value) {
  const errors = [];
  if (!isObject(value)) return validErrorResult([diagnostic('$', 'OBJECT', 'RunSpec must be an object.')]);
  const required = ['schema_version', 'name', 'case_id', 'engine', 'isolation', 'permissions', 'budget', 'scenario', 'evidence'];
  requireFields(value, required, '$', errors);
  validateNoUnexpectedFields(value, new Set(required), '$', errors);
  if (value.schema_version !== 2) errors.push(diagnostic('$.schema_version', 'CONST', 'schema_version must be 2.'));
  if (!isNonEmptyString(value.name)) errors.push(diagnostic('$.name', 'STRING', 'name must be non-empty.'));
  if (!isNonEmptyString(value.case_id)) errors.push(diagnostic('$.case_id', 'STRING', 'case_id must be non-empty.'));
  validateEngine(value.engine, errors);
  validateIsolation(value.isolation, errors);
  validatePermissions(value.permissions, errors);
  validateBudget(value.budget, errors);
  validateScenarioConfig(value.scenario, errors);
  validateEvidence(value.evidence, errors);
  return errors.length ? validErrorResult(errors) : { valid: true, errors: [], result: createResultEnvelope({ status: 'success', summary: `RunSpec ${value.name} is valid.`, artifacts: [] }) };
}

function validateEngine(value, errors) {
  if (!isObject(value)) return errors.push(diagnostic('$.engine', 'OBJECT', 'engine must be an object.'));
  requireFields(value, ['adapter', 'executable', 'configured_model', 'provider', 'credential_ref'], '$.engine', errors);
  validateNoUnexpectedFields(value, new Set(['adapter', 'executable', 'configured_model', 'reasoning_effort', 'provider', 'credential_ref']), '$.engine', errors);
  if (!ADAPTERS.has(value.adapter)) errors.push(diagnostic('$.engine.adapter', 'ENUM', 'adapter is unsupported.'));
  for (const field of ['executable', 'configured_model', 'provider']) if (!isNonEmptyString(value[field])) errors.push(diagnostic(`$.engine.${field}`, 'STRING', 'Field must be non-empty.'));
  if (value.reasoning_effort != null && !['low', 'medium', 'high', 'xhigh'].includes(value.reasoning_effort)) errors.push(diagnostic('$.engine.reasoning_effort', 'ENUM', 'reasoning_effort must be low, medium, high, xhigh or null.'));
  if (value.reasoning_effort != null && !['codex', 'codex-cli'].includes(value.adapter)) {
    errors.push(diagnostic('$.engine.reasoning_effort', 'ENGINE_OPTION_UNSUPPORTED', 'reasoning_effort is supported only by the Codex adapter.'));
  }
  if (!isNonEmptyString(value.credential_ref) || !/^[a-z][a-z0-9+.-]*:\/\//.test(value.credential_ref)) errors.push(diagnostic('$.engine.credential_ref', 'CREDENTIAL_REF', 'credential_ref must be a reference URI.'));
}

function validateIsolation(value, errors) {
  if (!isObject(value)) return errors.push(diagnostic('$.isolation', 'OBJECT', 'isolation must be an object.'));
  const fields = ['mode', 'leaderboard_eligible', 'network', 'block_internal_network', 'inherited_home_for_auth', 'answer_leakage_scan', 'workspace_root'];
  requireFields(value, fields, '$.isolation', errors);
  validateNoUnexpectedFields(value, new Set(fields), '$.isolation', errors);
  if (!['file-isolated-development', 'container', 'dedicated-user'].includes(value.mode)) errors.push(diagnostic('$.isolation.mode', 'ENUM', 'isolation mode is invalid.'));
  for (const field of ['leaderboard_eligible', 'block_internal_network', 'inherited_home_for_auth', 'answer_leakage_scan']) if (typeof value[field] !== 'boolean') errors.push(diagnostic(`$.isolation.${field}`, 'BOOLEAN', 'Field must be boolean.'));
  if (!(typeof value.network === 'boolean' || ['enabled', 'disabled'].includes(value.network))) errors.push(diagnostic('$.isolation.network', 'NETWORK_MODE', 'network must be boolean, enabled, or disabled.'));
  if (!isNonEmptyString(value.workspace_root)) errors.push(diagnostic('$.isolation.workspace_root', 'STRING', 'workspace_root must be non-empty.'));
  if (value.mode === 'file-isolated-development' && value.leaderboard_eligible === true) errors.push(diagnostic('$.isolation.leaderboard_eligible', 'ISOLATION_ELIGIBILITY', 'File isolation cannot be leaderboard eligible.'));
}

function validatePermissions(value, errors) {
  if (!isObject(value)) return errors.push(diagnostic('$.permissions', 'OBJECT', 'permissions must be an object.'));
  const fields = ['read_internal_source', 'read_answer_repository', 'hidden_evaluator_visible', 'allowed_tools'];
  requireFields(value, fields, '$.permissions', errors);
  validateNoUnexpectedFields(value, new Set(fields), '$.permissions', errors);
  for (const field of ['read_internal_source', 'read_answer_repository', 'hidden_evaluator_visible']) if (value[field] !== false) errors.push(diagnostic(`$.permissions.${field}`, 'FORBIDDEN_ACCESS', 'Benchmark agents must not receive this access.'));
  validateStringArray(value.allowed_tools, '$.permissions.allowed_tools', errors, { min: 1 });
}

function validateBudget(value, errors) {
  if (!isObject(value)) return errors.push(diagnostic('$.budget', 'OBJECT', 'budget must be an object.'));
  const fields = ['wall_time_minutes', 'max_retries', 'max_tokens', 'max_cost_usd'];
  requireFields(value, fields, '$.budget', errors);
  validateNoUnexpectedFields(value, new Set(fields), '$.budget', errors);
  validateNumber(value.wall_time_minutes, '$.budget.wall_time_minutes', errors, { exclusiveMin: true });
  validateNumber(value.max_retries, '$.budget.max_retries', errors, { integer: true });
  if (value.max_tokens !== null) validateNumber(value.max_tokens, '$.budget.max_tokens', errors, { integer: true, exclusiveMin: true });
  if (value.max_cost_usd !== null) validateNumber(value.max_cost_usd, '$.budget.max_cost_usd', errors);
}

function validateScenarioConfig(value, errors) {
  if (!isObject(value)) return errors.push(diagnostic('$.scenario', 'OBJECT', 'scenario must be an object.'));
  const fields = ['mode', 'baseline_type', 'session_continuity_required'];
  requireFields(value, fields, '$.scenario', errors);
  validateNoUnexpectedFields(value, new Set(fields), '$.scenario', errors);
  if (value.mode !== 'progressive-disclosure') errors.push(diagnostic('$.scenario.mode', 'CONST', 'scenario mode must be progressive-disclosure.'));
  if (!isNonEmptyString(value.baseline_type)) errors.push(diagnostic('$.scenario.baseline_type', 'STRING', 'baseline_type must be non-empty.'));
  if (typeof value.session_continuity_required !== 'boolean') errors.push(diagnostic('$.scenario.session_continuity_required', 'BOOLEAN', 'session_continuity_required must be boolean.'));
}

function validateEvidence(value, errors) {
  if (!isObject(value)) return errors.push(diagnostic('$.evidence', 'OBJECT', 'evidence must be an object.'));
  const fields = ['raw_stdout', 'raw_stderr', 'normalized_events', 'file_snapshots', 'git_diff', 'screenshots', 'redact_secrets', 'human_review_required'];
  requireFields(value, fields, '$.evidence', errors);
  validateNoUnexpectedFields(value, new Set(fields), '$.evidence', errors);
  for (const field of fields) if (typeof value[field] !== 'boolean') errors.push(diagnostic(`$.evidence.${field}`, 'BOOLEAN', 'Evidence field must be boolean.'));
  for (const field of ['redact_secrets', 'human_review_required']) if (value[field] !== true) errors.push(diagnostic(`$.evidence.${field}`, 'REQUIRED_EVIDENCE', 'Field must be true.'));
}

export function validateRepositoryContracts(root) {
  const errors = [];
  const artifacts = [];
  const casesRoot = resolve(root, 'cases');
  if (!existsSync(casesRoot)) return validErrorResult([diagnostic('cases', 'MISSING_DIRECTORY', 'cases directory is missing.')]);
  const caseIds = readdirSync(casesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  let primaryCount = 0;
  for (const caseId of caseIds) {
    const caseRoot = join(casesRoot, caseId);
    const paths = {
      config: join(caseRoot, 'case.yaml'),
      scenario: join(caseRoot, 'scenario', 'stages.yaml'),
      rubric: join(caseRoot, 'evaluator', 'rubric.yaml'),
    };
    for (const [name, path] of Object.entries(paths)) if (!existsSync(path)) errors.push(diagnostic(relative(root, path), 'MISSING_FILE', `${name} file is missing.`));
    if (existsSync(paths.config)) {
      const config = parseYaml(readFileSync(paths.config, 'utf8'));
      const result = validateCaseConfig(config, { expectedId: caseId });
      errors.push(...result.errors.map(error => ({ ...error, path: `${relative(root, paths.config)}:${error.path}` })));
      if (config.suite_role === 'primary') primaryCount += 1;
      for (const field of ['initial_prompt', 'scenario', 'requirement_truth', 'clarifications', 'acceptance', 'rubric', 'fixture', 'provenance', 'source_analysis']) {
        if (config[field] != null && !existsSync(resolve(caseRoot, config[field]))) errors.push(diagnostic(`${relative(root, paths.config)}:$.${field}`, 'MISSING_REFERENCE', `Referenced path ${config[field]} is missing.`));
      }
    }
    if (existsSync(paths.scenario)) {
      const scenario = parseYaml(readFileSync(paths.scenario, 'utf8'));
      const result = validateScenario(scenario);
      errors.push(...result.errors.map(error => ({ ...error, path: `${relative(root, paths.scenario)}:${error.path}` })));
    }
    if (existsSync(paths.rubric)) {
      const rubric = parseYaml(readFileSync(paths.rubric, 'utf8'));
      const result = validateRubric(rubric);
      errors.push(...result.errors.map(error => ({ ...error, path: `${relative(root, paths.rubric)}:${error.path}` })));
    }
    artifacts.push(relative(root, caseRoot));
  }
  if (primaryCount !== 3) errors.push(diagnostic('cases', 'PRIMARY_COUNT', `Expected 3 primary cases, found ${primaryCount}.`));
  const profilePath = resolve(root, 'config', 'run-profile.example.yaml');
  if (!existsSync(profilePath)) errors.push(diagnostic('config/run-profile.example.yaml', 'MISSING_FILE', 'Example RunSpec is missing.'));
  else {
    const result = validateRunSpec(parseYaml(readFileSync(profilePath, 'utf8')));
    errors.push(...result.errors.map(error => ({ ...error, path: `config/run-profile.example.yaml:${error.path}` })));
    artifacts.push('config/run-profile.example.yaml');
  }
  return errors.length ? validErrorResult(errors, artifacts) : {
    valid: true,
    errors: [],
    result: createResultEnvelope({
      status: 'success',
      summary: `Validated ${caseIds.length} cases, including ${primaryCount} primary cases, and the example RunSpec.`,
      next_actions: ['Build sanitized fixtures and executable evaluators for the three primary cases.'],
      artifacts,
    }),
  };
}
