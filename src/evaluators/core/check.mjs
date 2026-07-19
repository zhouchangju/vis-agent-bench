// Check definition, execution context, and result shape.
//
// A Check is a pure, serialisable description of one deterministic
// assertion. The runner is responsible for executing it inside an
// ExecutionContext and producing a CheckResult with structured evidence.

import { isStatus, STATUS } from './status.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

// A Check describes what to run and how to interpret its outcome.
//
// Required: id, kind, run.
// Optional metadata: title, category, level, weight, hard_gate, timeout_ms,
// depends_on, requires_artifacts.
//
// `run` is a function: (ctx) => Promise<CheckOutcome> | CheckOutcome.
// A CheckOutcome may be:
//   - a status string ('pass' | 'fail' | 'warning' | 'skipped');
//   - an object { status, reason?, evidence?, artifacts? }.
//
// `kind` partitions checks into deterministic families. The core reserves
// 'machine' and 'human'. Case-specific evaluators may introduce more kinds,
// but the core never invokes a Judge model.
export function defineCheck(check) {
  if (!check || typeof check !== 'object') {
    throw new TypeError('defineCheck: check must be an object.');
  }
  const id = check.id;
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9_]+)*$/.test(id)) {
    throw new TypeError(`defineCheck: id must be kebab/snake-case (got "${id}").`);
  }
  if (typeof check.run !== 'function') {
    throw new TypeError(`defineCheck(${id}): run must be a function.`);
  }
  const kind = check.kind || 'machine';
  if (!['machine', 'human'].includes(kind)) {
    throw new TypeError(`defineCheck(${id}): kind must be 'machine' or 'human' (got "${kind}").`);
  }
  const level = check.level || 'p1';
  if (!['p0', 'p1', 'p2'].includes(level)) {
    throw new TypeError(`defineCheck(${id}): level must be p0, p1, or p2.`);
  }
  if (check.depends_on != null && !isStringArray(check.depends_on)) {
    throw new TypeError(`defineCheck(${id}): depends_on must be an array of check ids.`);
  }
  if (check.requires_artifacts != null && !isStringArray(check.requires_artifacts)) {
    throw new TypeError(`defineCheck(${id}): requires_artifacts must be an array of artifact ids.`);
  }
  if (check.timeout_ms != null) {
    if (typeof check.timeout_ms !== 'number' || check.timeout_ms <= 0) {
      throw new TypeError(`defineCheck(${id}): timeout_ms must be a positive number.`);
    }
  }
  const command = normaliseCommand(check.command, id);
  return Object.freeze({
    id,
    title: typeof check.title === 'string' && check.title.trim() ? check.title : id,
    kind,
    level,
    category: typeof check.category === 'string' && check.category.trim() ? check.category : null,
    weight: typeof check.weight === 'number' && check.weight >= 0 ? check.weight : null,
    hard_gate: check.hard_gate === true,
    timeout_ms: check.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    depends_on: Object.freeze([...(check.depends_on || [])]),
    requires_artifacts: Object.freeze([...(check.requires_artifacts || [])]),
    command,
    run: check.run,
    metadata: check.metadata && typeof check.metadata === 'object' ? Object.freeze({ ...check.metadata }) : null,
  });
}

// Optional command spec for command-mode checks. When present, the runner
// spawns it before invoking run() so the assertion can read captured
// stdout/stderr paths and exit metadata from `executor`.
function normaliseCommand(command, checkId) {
  if (command == null) return null;
  if (typeof command !== 'object') {
    throw new TypeError(`defineCheck(${checkId}): command must be an object.`);
  }
  if (typeof command.executable !== 'string' || !command.executable) {
    throw new TypeError(`defineCheck(${checkId}): command.executable must be a non-empty string.`);
  }
  if (command.args != null && !Array.isArray(command.args)) {
    throw new TypeError(`defineCheck(${checkId}): command.args must be an array.`);
  }
  const id = typeof command.id === 'string' && command.id
    ? command.id
    : (typeof command.label === 'string' && command.label ? command.label : checkId);
  return Object.freeze({
    id,
    executable: command.executable,
    args: Object.freeze([...(command.args || [])]),
    env: command.env && typeof command.env === 'object' ? Object.freeze({ ...command.env }) : null,
    stdin: command.stdin ?? null,
  });
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);
}

// ExecutionContext is what a Check's run() receives. It carries workspace
// and artifact lookups, plus a cancellation flag the runner can flip when a
// dependency or the run budget failed.
export function createExecutionContext({
  runId,
  caseId,
  workspace,
  artifacts = {},
  env = {},
  abortSignal = null,
  logger = null,
} = {}) {
  const artifactMap = new Map(Object.entries(artifacts));
  const ctx = {
    runId: runId || null,
    caseId: caseId || null,
    workspace: workspace || null,
    env: Object.freeze({ ...env }),
    abortSignal: abortSignal || null,
    logger: typeof logger === 'function' ? logger : () => {},
    getArtifact(id) {
      return artifactMap.has(id) ? artifactMap.get(id) : null;
    },
    hasArtifact(id) {
      return artifactMap.has(id);
    },
    listArtifacts() {
      return [...artifactMap.keys()].sort();
    },
  };
  return Object.freeze(ctx);
}

// Normalise whatever a Check.run returns into a CheckResult skeleton. The
// runner fills in command/exit/stdout/stderr/duration/failure_source.
export function normaliseOutcome(check, outcome) {
  if (outcome == null) {
    throw new Error(`Check "${check.id}" returned no outcome.`);
  }
  let status;
  let reason = null;
  let evidence = null;
  let artifacts = [];
  if (typeof outcome === 'string') {
    status = outcome;
  } else if (typeof outcome === 'object') {
    status = outcome.status;
    reason = typeof outcome.reason === 'string' ? outcome.reason : null;
    evidence = outcome.evidence ?? null;
    if (Array.isArray(outcome.artifacts)) artifacts = outcome.artifacts;
  } else {
    throw new TypeError(`Check "${check.id}" returned an unsupported outcome type.`);
  }
  if (!isStatus(status)) {
    throw new TypeError(`Check "${check.id}" returned an invalid status "${status}".`);
  }
  return {
    check_id: check.id,
    status,
    reason,
    evidence,
    artifacts: [...artifacts],
  };
}

// Build a CheckResult representing an evaluator crash. failure_source is
// always 'evaluator' for these so they never get confused with project
// failures.
export function harnessErrorResult(check, { reason, error }) {
  return {
    check_id: check.id,
    status: STATUS.ERROR,
    reason: reason || 'evaluator harness failed before completing the check',
    evidence: error && error.stack ? { stack: String(error.stack) } : null,
    artifacts: [],
    command: null,
    exit_code: null,
    stdout_path: null,
    stderr_path: null,
    duration_ms: 0,
    failure_source: 'evaluator',
  };
}

// Build a skipped CheckResult. Used when dependencies or required artifacts
// are missing so the assertion cannot run deterministically.
export function skippedResult(check, reason) {
  return {
    check_id: check.id,
    status: STATUS.SKIPPED,
    reason: reason || 'skipped due to unmet preconditions',
    evidence: null,
    artifacts: [],
    command: null,
    exit_code: null,
    stdout_path: null,
    stderr_path: null,
    duration_ms: 0,
    failure_source: 'evaluator',
  };
}

// Attach executor-side metadata to a normalised outcome. The runner calls
// this once it has captured process-level evidence.
export function attachExecutorEvidence(result, executor) {
  return {
    ...result,
    command: executor?.command ?? null,
    exit_code: executor?.exit_code ?? null,
    signal: executor?.signal ?? null,
    timed_out: executor?.timed_out === true,
    stdout_path: executor?.stdout_path ?? null,
    stderr_path: executor?.stderr_path ?? null,
    duration_ms: typeof executor?.duration_ms === 'number' ? executor.duration_ms : 0,
    failure_source: result.failure_source ?? inferFailureSource(result, executor),
  };
}

function inferFailureSource(result, executor) {
  if (result.status === STATUS.ERROR) return 'evaluator';
  if (result.status === STATUS.FAIL) return 'project';
  if (result.status === STATUS.SKIPPED) return 'evaluator';
  if (executor && typeof executor.exit_code === 'number' && executor.exit_code !== 0) {
    return 'project';
  }
  return null;
}
