import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { collectBooleanPaths } from '../evaluators/control/observation-attestation.mjs';
import { sha256 } from './golden-observations.mjs';

/**
 * Allowed provenance sources for boolean facts (must match
 * SOURCE_BINDINGS in observation-attestation.mjs). Each source maps 1:1 to a
 * binding kind that verifyBinding knows how to digest.
 */
const PROVENANCE_BINDING_BY_SOURCE = Object.freeze({
  browser_action: 'browser_evidence',
  browser_state: 'browser_evidence',
  command: 'command_evidence',
  workspace_state: 'workspace_diff_evidence',
  hidden_control: 'hidden_control_execution',
});

const COLLECTOR_ID = 'bench-run-collector';
const COLLECTOR_VERSION = '1.0';

/**
 * Collect a trusted observation and its attestation from a finished CLI run
 * directory. Reads artifacts from disk, derives boolean facts conservatively
 * (never fabricates), writes the binding documents + observation.json, and
 * returns the attestation envelope ready to be written as
 * observation-attestation.json.
 *
 * Failure semantics: hard errors (missing required artifacts, escape attempts,
 * locator mismatch) throw an Error with `.code` / `.root_cause_hint` /
 * `.safe_retry` / `.stop_condition` so callers can record them in
 * `result.attestation_error` and let the user recover via
 * `bench.mjs collect-attestation`.
 *
 * Returns { observation, attestation, warnings }.
 */
export async function collectRunObservation({
  projectRoot,
  runRoot,
  caseId,
  runId,
  caseRuntime,
}) {
  if (!projectRoot) throw missingArg('projectRoot');
  if (!runRoot) throw missingArg('runRoot');
  if (!caseId) throw missingArg('caseId');
  if (!runId) throw missingArg('runId');
  if (!caseRuntime) throw missingArg('caseRuntime');

  const root = realpathSafe(runRoot);
  const collectedAt = new Date().toISOString();
  const warnings = [];

  // ---- 1. Read raw run artifacts ----------------------------------------------------
  const resultJson = readJsonOptional(join(root, 'result.json'));
  if (!resultJson) {
    throw attestationError(
      'RESULT_JSON_MISSING',
      `result.json not found in ${root}`,
      'Re-run the stage or restore result.json; the collector needs it to bind command evidence.',
    );
  }

  const commandLogPath = join(root, 'logs', 'commands.json');
  const commandLogRaw = readTextOptional(commandLogPath);
  if (commandLogRaw == null) {
    throw attestationError(
      'COMMAND_EVIDENCE_MISSING',
      `logs/commands.json not found in ${root}`,
      'Re-execute the run, or regenerate logs/commands.json from the stage command log.',
    );
  }

  // workspace.diff is best-effort: requireEvidenceBindings accepts command_evidence alone.
  // Note: observation-attestation.mjs verifyBinding() parses every binding file as JSON,
  // so we cannot bind the raw text diff directly. We wrap it in a JSON envelope document.
  const rawWorkspaceDiffPath = join(root, 'artifacts', 'workspace.diff');
  const rawWorkspaceDiff = readTextOptional(rawWorkspaceDiffPath);
  const workspaceDiffRelative = 'artifacts/workspace-diff-evidence.json';
  let workspaceDiffRaw;
  if (rawWorkspaceDiff == null) {
    warnings.push(`workspace diff not found at ${rawWorkspaceDiffPath}; emitting empty marker`);
    workspaceDiffRaw = `${JSON.stringify({
      schema_version: 1,
      kind: 'workspace-diff-evidence',
      availability: 'unavailable',
      reason: 'artifacts/workspace.diff was not produced for this run',
      collected_at: collectedAt,
      diff: '',
    }, null, 2)}\n`;
  } else {
    workspaceDiffRaw = `${JSON.stringify({
      schema_version: 1,
      kind: 'workspace-diff-evidence',
      availability: 'captured',
      source_path: 'artifacts/workspace.diff',
      collected_at: collectedAt,
      diff: rawWorkspaceDiff,
    }, null, 2)}\n`;
  }

  // fixture manifest is REQUIRED by requireEvidenceBindings.
  const fixtureManifestPath = join(root, 'workspace', '.fixture', 'manifest.json');
  const fixtureManifestRaw = readTextOptional(fixtureManifestPath);
  if (fixtureManifestRaw == null) {
    throw attestationError(
      'FIXTURE_MANIFEST_MISSING',
      `workspace/.fixture/manifest.json not found in ${root}`,
      'Run `bench.mjs build-fixture` (or re-prepare) before running the benchmark.',
    );
  }

  // ---- 2. Discover optional browser evidence ---------------------------------------
  const browserLocator = locateBrowserEvidence(root);
  let browserEvidenceRaw;
  let browserEvidenceRelative;
  if (browserLocator) {
    const text = readTextOptional(browserLocator.absolute);
    if (text == null) {
      throw attestationError(
        'BROWSER_EVIDENCE_UNREADABLE',
        `browser evidence at ${browserLocator.absolute} is not readable`,
        'Re-run the browser capture step, or remove the path so the collector emits an unavailable marker.',
      );
    }
    browserEvidenceRaw = text;
    browserEvidenceRelative = browserLocator.relative;
  } else {
    // No browser evidence captured. We MUST still emit a binding file so
    // requireEvidenceBindings passes; mark it explicitly unavailable and write
    // a marker document (no fabricated facts inside).
    warnings.push('no browser evidence captured; emitting unavailable marker binding');
    browserEvidenceRelative = 'browser-evidence.json';
    browserEvidenceRaw = `${JSON.stringify({
      schema_version: 1,
      kind: 'browser-evidence',
      run_id: runId,
      case_id: caseId,
      captured_at: collectedAt,
      availability: 'unavailable',
      reason: 'No browser evidence capture was performed for this CLI run.',
      steps: [],
      blobs: [],
      notes: [
        'This marker exists only to satisfy the attestation binding contract.',
        'It contains no observable browser facts; absent booleans must not be treated as true.',
      ],
    }, null, 2)}\n`;
  }

  // ---- 3. Build hidden control execution evidence ----------------------------------
  const hiddenControl = buildHiddenControlExecution({
    projectRoot,
    caseRuntime,
    resultJson,
    collectedAt,
  });
  const hiddenControlRelative = 'hidden-control-execution.json';
  const hiddenControlRaw = `${JSON.stringify(hiddenControl, null, 2)}\n`;

  // ---- 4. Build command evidence projection ----------------------------------------
  // The command_evidence binding document MUST mirror the parts of the
  // observation that bind to it (e.g. /commands/<name>/ran) so the validator's
  // locator resolution passes.
  const commandEvidence = buildCommandEvidence({ resultJson, commandLogRaw, hiddenControl });
  const commandEvidenceRelative = 'command-evidence.json';
  const commandEvidenceRaw = `${JSON.stringify(commandEvidence, null, 2)}\n`;

  // ---- 5. Flush binding documents that are new to disk -----------------------------
  // (fixture_manifest already exists; raw artifacts/workspace.diff may already exist)
  writeBindingFile(root, commandEvidenceRelative, commandEvidenceRaw);
  writeBindingFile(root, hiddenControlRelative, hiddenControlRaw);
  writeBindingFile(root, browserEvidenceRelative, browserEvidenceRaw);
  writeBindingFile(root, workspaceDiffRelative, workspaceDiffRaw);

  // ---- 6. Compute digests from the real on-disk bytes ------------------------------
  // fixtureManifestPath is already absolute (under runRoot), so we read it directly.
  const bindingDigests = {
    command_evidence: sha256(readFileSync(join(root, commandEvidenceRelative))),
    workspace_diff_evidence: sha256(readFileSync(join(root, workspaceDiffRelative))),
    browser_evidence: sha256(readFileSync(join(root, browserEvidenceRelative))),
    hidden_control_execution: sha256(readFileSync(join(root, hiddenControlRelative))),
    fixture_manifest: sha256(readFileSync(fixtureManifestPath)),
  };
  const bindingPaths = {
    command_evidence: commandEvidenceRelative,
    workspace_diff_evidence: workspaceDiffRelative,
    browser_evidence: browserEvidenceRelative,
    hidden_control_execution: hiddenControlRelative,
    fixture_manifest: relative(root, fixtureManifestPath),
  };
  const bindingDocuments = {
    command_evidence: JSON.parse(readFileSync(join(root, commandEvidenceRelative), 'utf8')),
    workspace_diff_evidence: JSON.parse(readFileSync(join(root, workspaceDiffRelative), 'utf8')),
    browser_evidence: JSON.parse(readFileSync(join(root, browserEvidenceRelative), 'utf8')),
    hidden_control_execution: JSON.parse(readFileSync(join(root, hiddenControlRelative), 'utf8')),
    fixture_manifest: JSON.parse(readFileSync(fixtureManifestPath, 'utf8')),
  };

  // ---- 7. Compose observation + attach provenance ---------------------------------
  const baseObservation = composeObservation({
    resultJson,
    commandEvidence,
    fixtureManifestRaw,
    browserEvidenceRaw,
    hiddenControl,
    collectedAt,
  });
  const observation = annotateBooleanProvenance(baseObservation, bindingDigests);
  validateProvenanceLocators(observation, bindingDocuments);

  // ---- 8. Write observation.json (referenced by the observation binding) ----------
  const observationText = JSON.stringify(observation);
  writeFileSync(join(root, 'observation.json'), observationText);
  const observationDigest = sha256(observationText);

  // ---- 9. Assemble attestation ----------------------------------------------------
  const attestation = {
    schema_version: 1,
    kind: 'trusted-observation-attestation',
    run_id: runId,
    case_id: caseId,
    collected_at: collectedAt,
    collector: {
      id: COLLECTOR_ID,
      version: COLLECTOR_VERSION,
      // Real CLI runs are eligible for conclusions, unlike the golden demo.
      demo_only: false,
      conclusion_eligible: true,
    },
    observation,
    bindings: {
      observation: { path: 'observation.json', sha256: observationDigest },
      fixture_manifest: {
        path: bindingPaths.fixture_manifest,
        sha256: bindingDigests.fixture_manifest,
      },
      command_evidence: {
        path: bindingPaths.command_evidence,
        sha256: bindingDigests.command_evidence,
      },
      workspace_diff_evidence: {
        path: bindingPaths.workspace_diff_evidence,
        sha256: bindingDigests.workspace_diff_evidence,
      },
      browser_evidence: {
        path: bindingPaths.browser_evidence,
        sha256: bindingDigests.browser_evidence,
      },
      hidden_control_execution: {
        path: bindingPaths.hidden_control_execution,
        sha256: bindingDigests.hidden_control_execution,
      },
    },
    trust: {
      evidence_level: 'harness_attested_run',
      notes: [
        'Observation derived from CLI run artifacts only.',
        'Boolean facts are bound to command_evidence / workspace_diff_evidence / browser_evidence / hidden_control_execution digests.',
        'Token and cost fields are reported as unavailable when the CLI did not emit them.',
      ],
    },
  };

  return { observation, attestation, warnings };
}

// ---------------------------------------------------------------------------
// Observation + binding composition
// ---------------------------------------------------------------------------

function composeObservation({
  resultJson,
  commandEvidence,
  fixtureManifestRaw,
  browserEvidenceRaw,
  hiddenControl,
  collectedAt,
}) {
  let fixtureManifest;
  try {
    fixtureManifest = JSON.parse(fixtureManifestRaw);
  } catch {
    fixtureManifest = {};
  }
  let browserEvidence;
  try {
    browserEvidence = JSON.parse(browserEvidenceRaw);
  } catch {
    browserEvidence = { availability: 'unavailable' };
  }

  // Mirror the commands block from the command_evidence binding document so
  // every boolean under /commands/* has a locator that resolves in BOTH the
  // observation and the command_evidence document.
  const commands = structuredClone(commandEvidence.commands || {});

  // The dsl block mirrors hidden_control_execution so /dsl/* locators resolve.
  const dsl = structuredClone(hiddenControl.dsl || {});

  // lifecycle mirrors hidden_control_execution so /lifecycle/* locators resolve.
  const lifecycle = structuredClone(hiddenControl.lifecycle || {});

  const observation = {
    collected_at: collectedAt,
    commands,
    dsl,
    lifecycle,
    run: {
      status: resultJson.status || 'unknown',
      duration_ms: typeof resultJson.duration_ms === 'number' ? resultJson.duration_ms : null,
      stage_count: commandEvidence.stages.length,
      completed_stage_count: commandEvidence.stages.filter(stage => stage.status === 'success').length,
      // tokens/cost are unavailable unless explicitly reported; never fabricate.
      usage: extractUsageAvailability(resultJson.usage),
    },
    fixture: {
      manifest_version: fixtureManifest.manifest_version || null,
      export: fixtureManifest.export || null,
      source_descriptor: fixtureManifest.source_descriptor || null,
    },
    browserEvidence,
  };

  if (browserEvidence && browserEvidence.availability === 'unavailable') {
    observation.browserEvidenceAvailability = 'unavailable';
  }

  return observation;
}

function extractUsageAvailability(usage) {
  if (!usage || typeof usage !== 'object') {
    return { availability: 'unavailable' };
  }
  const reported = ['input_tokens', 'output_tokens', 'cached_tokens', 'total_tokens']
    .some(key => typeof usage[key] === 'number');
  if (!reported && typeof usage.cost_usd !== 'number') {
    return { availability: 'unavailable' };
  }
  return {
    availability: 'reported',
    input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
    output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
    cached_tokens: typeof usage.cached_tokens === 'number' ? usage.cached_tokens : null,
    total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
    cost_usd: typeof usage.cost_usd === 'number' ? usage.cost_usd : null,
  };
}

function buildHiddenControlExecution({
  projectRoot,
  caseRuntime,
  resultJson,
  collectedAt,
}) {
  // Read fixture plan.yaml to learn which baseline commands the case expects.
  let plan;
  try {
    plan = parseYaml(readFileSync(caseRuntime.plan, 'utf8'));
  } catch {
    plan = {};
  }
  const baseline = plan && typeof plan.baseline === 'object' ? plan.baseline : {};

  const stages = Array.isArray(resultJson.stages) ? resultJson.stages : [];

  // Map checkpoint gate statuses into command exit codes when available.
  // Field style follows the observation contract consumed by case evaluators
  // (camelCase `exitCode`, matching the golden observation samples).
  const commands = {};
  for (const name of ['build', 'typecheck', 'test']) {
    const entry = baseline[name];
    const required = entry?.required !== false;
    const observed = findCommandOutcome(stages, name);
    commands[name] = {
      required,
      command: Array.isArray(entry?.command) ? entry.command : null,
      ran: observed.ran,
      exitCode: observed.exitCode,
      source: observed.source,
    };
  }

  // DSL execution facts: real CLI runs do NOT re-execute the hidden control
  // harness. Mark every fact conservatively; never claim acceptance/rejection
  // happened. These nulls are NOT booleans, so they require no provenance.
  const dsl = {
    control_inputs_executed: false,
    validAccepted: null,
    invalidRejected: null,
    hiddenInvalidSampleUsed: null,
    optionalAudioAccepted: null,
    invalidCausedUncaughtError: null,
  };

  const lifecycle = {
    stages_total: stages.length,
    stages_success: stages.filter(stage => stage.status === 'success').length,
    stages_error: stages.filter(stage => stage.status === 'error').length,
    // agent-reported cleanup counts are unavailable unless captured.
    afterDestroy: null,
    callbacksAfterDestroy: null,
  };

  return {
    schema_version: 1,
    kind: 'hidden-control-execution',
    collected_at: collectedAt,
    case_id: caseRuntime.caseId,
    plan_path: relative(projectRoot, caseRuntime.plan),
    commands: structuredClone(commands),
    dsl,
    lifecycle,
    notes: [
      'Real CLI runs do not re-execute the hidden control harness.',
      'Boolean facts derived from this document are intentionally conservative: false/unavailable unless proven by artifacts.',
    ],
  };
}

function findCommandOutcome(stages, name) {
  // Look through checkpoint_gate data in stage results for a build/typecheck/test
  // gate. checkpoint_gate is recorded in scripts/bench.mjs via verifyStageDeliverables
  // as { commands: [{ name, exit_code, ... }] }; the legacy { checks: [{ id, ... }] }
  // shape is still accepted for older run directories.
  for (const stage of stages) {
    const gate = stage && typeof stage === 'object' ? stage.checkpoint_gate : null;
    if (!gate || typeof gate !== 'object') continue;
    const commands = Array.isArray(gate.commands) ? gate.commands : [];
    for (const command of commands) {
      if (command && command.name === name) {
        return {
          ran: true,
          exitCode: typeof command.exit_code === 'number' ? command.exit_code : null,
          source: 'checkpoint_gate',
        };
      }
    }
    const checks = Array.isArray(gate.checks) ? gate.checks : [];
    for (const check of checks) {
      if (check && check.id === name) {
        return {
          ran: true,
          exitCode: typeof check.exit_code === 'number'
            ? check.exit_code
            : (check.status === 'pass' ? 0 : 1),
          source: 'checkpoint_gate',
        };
      }
    }
  }
  return { ran: false, exitCode: null, source: 'unavailable' };
}

function buildCommandEvidence({ resultJson, commandLogRaw, hiddenControl }) {
  let commandLog;
  try {
    commandLog = JSON.parse(commandLogRaw);
  } catch {
    commandLog = [];
  }
  return {
    schema_version: 1,
    kind: 'command-evidence',
    run_id: resultJson.run_id || null,
    case_id: resultJson.case_id || null,
    status: resultJson.status || 'unknown',
    // The /commands map is the single source of truth for command booleans.
    // Mirrored verbatim into the observation so locator resolution passes.
    commands: structuredClone(hiddenControl.commands || {}),
    stages: Array.isArray(resultJson.stages)
      ? resultJson.stages.map(stage => ({
        stage_id: stage.stage_id,
        status: stage.status,
        exit_code: typeof stage.exit_code === 'number' ? stage.exit_code : null,
        failure_source: stage.failure_source || null,
        error: stage.error || null,
      }))
      : [],
    command_log: Array.isArray(commandLog) ? commandLog : [],
  };
}

// ---------------------------------------------------------------------------
// Provenance annotation + validation
// ---------------------------------------------------------------------------

function annotateBooleanProvenance(observation, bindingDigests) {
  const output = structuredClone(observation);
  const paths = collectBooleanPaths(output);
  const facts = {};
  for (const path of paths) {
    const classification = classifyPath(path);
    const binding = classification.binding;
    const digest = bindingDigests[binding];
    if (!digest) {
      throw attestationError(
        'PROVENANCE_BINDING_DIGEST_MISSING',
        `No digest available for binding "${binding}" required by boolean "${path}".`,
        'Ensure all binding documents are written before annotating provenance.',
      );
    }
    facts[path] = [{
      source: classification.source,
      binding,
      locator: classification.locator,
      sha256: digest,
    }];
  }
  output.provenance = { boolean_facts: facts };
  return output;
}

function classifyPath(path) {
  // Map observation boolean JSON Pointers to (source, binding) per
  // observation-attestation.mjs SOURCE_BINDINGS.
  if (path.startsWith('/commands/')) {
    return { source: 'command', binding: 'command_evidence', locator: path };
  }
  if (path.startsWith('/dsl/')) {
    return { source: 'hidden_control', binding: 'hidden_control_execution', locator: path };
  }
  if (path.startsWith('/lifecycle/')) {
    return { source: 'hidden_control', binding: 'hidden_control_execution', locator: path };
  }
  if (path.startsWith('/browserEvidence')) {
    return { source: 'browser_state', binding: 'browser_evidence', locator: path };
  }
  // run/ and fixture/ describe result.json-derived facts; bind to command_evidence.
  if (path.startsWith('/run/') || path.startsWith('/fixture/')) {
    return { source: 'command', binding: 'command_evidence', locator: path };
  }
  // Conservative default: command_evidence (never browser, since browser may be unavailable).
  return { source: 'command', binding: 'command_evidence', locator: path };
}

function validateProvenanceLocators(observation, bindingDocuments) {
  const facts = observation.provenance?.boolean_facts;
  if (!facts) return;
  for (const [path, refs] of Object.entries(facts)) {
    for (const ref of refs) {
      const doc = bindingDocuments[ref.binding];
      if (doc == null) {
        throw attestationError(
          'PROVENANCE_BINDING_NOT_JSON',
          `Boolean "${path}" binds to "${ref.binding}" which has no JSON document to resolve locator "${ref.locator}".`,
          'Move the boolean to a JSON-backed binding (command_evidence / hidden_control_execution / browser_evidence).',
        );
      }
      if (!pointerExists(doc, ref.locator)) {
        throw attestationError(
          'PROVENANCE_LOCATOR_MISSING',
          `Boolean "${path}" locator "${ref.locator}" does not exist in ${ref.binding} document.`,
          'Update annotateBooleanProvenance classification so the locator path matches the binding document.',
        );
      }
    }
  }
}

function pointerExists(document, pointer) {
  if (pointer === '') return true;
  if (!pointer.startsWith('/')) return false;
  let value = document;
  for (const token of pointer.slice(1).split('/').map(unescapePointer)) {
    if (
      value == null
      || typeof value !== 'object'
      || !Object.prototype.hasOwnProperty.call(value, token)
    ) {
      return false;
    }
    value = value[token];
  }
  return true;
}

function unescapePointer(token) {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

function locateBrowserEvidence(root) {
  const candidates = [
    'browser-evidence.json',
    join('browser-evidence', 'evidence.json'),
  ];
  for (const candidate of candidates) {
    const absolute = join(root, candidate);
    if (existsSync(absolute)) {
      return { absolute, relative: candidate };
    }
  }
  return null;
}

function writeBindingFile(root, relativePath, content) {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function realpathSafe(runRoot) {
  if (!existsSync(runRoot)) {
    throw attestationError(
      'RUN_ROOT_MISSING',
      `Run directory does not exist: ${runRoot}`,
      'Create the run with `bench.mjs prepare` first.',
    );
  }
  return realpathSync(runRoot);
}

function readJsonOptional(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readTextOptional(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function missingArg(name) {
  return attestationError(
    'MISSING_ARGUMENT',
    `collectRunObservation requires argument "${name}".`,
    `Pass ${name} from the caller (bench.mjs run or collect-attestation).`,
  );
}

function attestationError(code, message, rootCauseHint) {
  const error = new Error(message);
  error.code = code;
  error.root_cause_hint = rootCauseHint || message;
  error.safe_retry = 'Re-run `bench.mjs collect-attestation --run-dir <path>` after addressing the root cause.';
  error.stop_condition = 'Stop after two identical failures with the same code.';
  return error;
}

/**
 * Convenience helper: writes the attestation envelope to
 * <runRoot>/observation-attestation.json. Returns the absolute path written.
 */
export function writeAttestation(runRoot, attestation) {
  const target = join(runRoot, 'observation-attestation.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(attestation, null, 2)}\n`);
  return target;
}

export function computeFileDigest(path) {
  return sha256(readFileSync(path));
}

export { sha256 };
