import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_BINDINGS = Object.freeze({
  browser_action: 'browser_evidence',
  browser_state: 'browser_evidence',
  command: 'command_evidence',
  workspace_state: 'workspace_diff_evidence',
  hidden_control: 'hidden_control_execution',
});

export function resolveObservationInput({
  caseId,
  runId,
  runRoot,
  attestationPath,
  observation,
  observationPath,
  allowTestDouble = false,
}) {
  if (allowTestDouble === true) {
    if (attestationPath || runRoot) {
      throw new TypeError('Test-double mode cannot be combined with a production attestation.');
    }
    const resolvedObservation = observation ?? readTestDouble(observationPath);
    validateBooleanProvenance(resolvedObservation, { testDouble: true });
    return {
      observation: resolvedObservation,
      trust: {
        mode: 'test-double',
        conclusion_eligible: false,
        disclaimer: 'Test-double observation; it must not be used as a real benchmark Run conclusion.',
      },
    };
  }

  if (observation !== undefined || observationPath !== undefined) {
    throw new TypeError(
      'Production evaluators reject bare observation/observationPath; provide runRoot and attestationPath.',
    );
  }
  if (!runId || !caseId || !runRoot || !attestationPath) {
    throw new TypeError(
      'Production evaluation requires runId, caseId, runRoot, and attestationPath.',
    );
  }

  const root = realpathSync(runRoot);
  const attestationRealPath = containedRealPath(root, attestationPath, 'attestation');
  const attestation = parseJsonFile(attestationRealPath, 'attestation');
  validateEnvelope(attestation, { runId, caseId });

  const verifiedBindings = {};
  for (const [name, binding] of Object.entries(attestation.bindings)) {
    verifiedBindings[name] = verifyBinding(root, name, binding);
  }
  requireEvidenceBindings(verifiedBindings);

  const observationBinding = verifiedBindings.observation;
  const resolvedObservation = parseJsonFile(observationBinding.real_path, 'observation');
  validateBooleanProvenance(resolvedObservation, {
    bindingDigests: Object.fromEntries(
      Object.entries(verifiedBindings).map(([name, value]) => [name, value.sha256]),
    ),
    bindingDocuments: Object.fromEntries(
      Object.entries(verifiedBindings).map(([name, value]) => [name, value.document]),
    ),
  });

  return {
    observation: resolvedObservation,
    trust: {
      mode: 'control-plane-attested',
      conclusion_eligible: true,
      run_id: attestation.run_id,
      case_id: attestation.case_id,
      collector: structuredClone(attestation.collector),
      attestation_path: attestationRealPath,
      bindings: Object.fromEntries(
        Object.entries(verifiedBindings).map(([name, value]) => [
          name,
          { path: value.real_path, sha256: value.sha256 },
        ]),
      ),
      limitation: [
        'This is a control-plane integrity binding.',
        'It is not cryptographic isolation from a malicious process running as the same OS user.',
      ].join(' '),
    },
  };
}

export function annotateEvaluationTrust(evaluation, trust) {
  const evidenceTrust = structuredClone(trust);
  const notes = trust.mode === 'test-double'
    ? [evaluation.bundle.notes, trust.disclaimer].filter(Boolean).join(' ')
    : evaluation.bundle.notes;
  return {
    ...evaluation,
    evidence_trust: evidenceTrust,
    bundle: {
      ...evaluation.bundle,
      evidence_trust: evidenceTrust,
      notes,
    },
  };
}

export function validateBooleanProvenance(observation, {
  testDouble = false,
  bindingDigests = {},
  bindingDocuments = {},
} = {}) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('Observation must be an object before provenance validation.');
  }
  const facts = observation.provenance?.boolean_facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new TypeError('Observation requires provenance.boolean_facts.');
  }

  const booleanPaths = collectBooleanPaths(observation);
  for (const path of booleanPaths) {
    const references = facts[path];
    if (!Array.isArray(references) || references.length === 0) {
      throw new TypeError(`Boolean observation "${path}" is missing provenance.`);
    }
    for (const reference of references) {
      validateProvenanceReference(path, reference, {
        testDouble,
        bindingDigests,
        bindingDocuments,
      });
    }
  }
  return { booleanPaths };
}

export function collectBooleanPaths(value, path = '') {
  if (typeof value === 'boolean') return [path || '/'];
  if (!value || typeof value !== 'object') return [];
  if (path === '/provenance') return [];
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    paths.push(...collectBooleanPaths(child, `${path}/${escapePointer(key)}`));
  }
  return paths;
}

function validateEnvelope(attestation, { runId, caseId }) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    throw new TypeError('Observation attestation must be an object.');
  }
  if (attestation.schema_version !== 1 || attestation.kind !== 'trusted-observation-attestation') {
    throw new TypeError('Unsupported trusted observation attestation schema.');
  }
  if (attestation.run_id !== runId || attestation.case_id !== caseId) {
    throw new TypeError('Attestation run_id/case_id does not match the evaluation request.');
  }
  if (
    !attestation.collector
    || typeof attestation.collector.id !== 'string'
    || attestation.collector.id.trim().length === 0
  ) {
    throw new TypeError('Attestation requires a non-empty collector.id.');
  }
  if (!attestation.bindings || typeof attestation.bindings !== 'object') {
    throw new TypeError('Attestation requires bindings.');
  }
}

function requireEvidenceBindings(bindings) {
  for (const name of [
    'observation',
    'fixture_manifest',
    'browser_evidence',
    'hidden_control_execution',
  ]) {
    if (!bindings[name]) throw new TypeError(`Attestation is missing "${name}" binding.`);
  }
  const command = bindings.command_evidence;
  const workspace = bindings.workspace_diff_evidence;
  if (!command && !workspace) {
    throw new TypeError(
      'Attestation requires command_evidence or workspace_diff_evidence binding.',
    );
  }
}

function verifyBinding(root, name, binding) {
  if (!binding || typeof binding !== 'object') {
    throw new TypeError(`Attestation binding "${name}" must be an object.`);
  }
  if (!SHA256.test(binding.sha256 || '')) {
    throw new TypeError(`Attestation binding "${name}" requires a lowercase SHA-256.`);
  }
  const realPath = containedRealPath(root, binding.path, `binding "${name}"`);
  if (!statSync(realPath).isFile()) {
    throw new TypeError(`Attestation binding "${name}" must resolve to a regular file.`);
  }
  const content = readFileSync(realPath);
  const actual = sha256(content);
  if (actual !== binding.sha256) {
    throw new TypeError(`Attestation binding "${name}" SHA-256 mismatch.`);
  }
  let document;
  try {
    document = JSON.parse(content.toString('utf8'));
  } catch (error) {
    throw new TypeError(`Attestation binding "${name}" must contain JSON: ${error.message}`);
  }
  return { real_path: realPath, sha256: actual, document };
}

function containedRealPath(root, candidate, label) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new TypeError(`${label} path must be a non-empty string.`);
  }
  const lexical = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const real = realpathSync(lexical);
  const rel = relative(root, real);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new TypeError(`${label} realpath escapes the control-plane run root.`);
  }
  return real;
}

function validateProvenanceReference(path, reference, {
  testDouble,
  bindingDigests,
  bindingDocuments,
}) {
  if (!reference || typeof reference !== 'object') {
    throw new TypeError(`Boolean observation "${path}" has invalid provenance.`);
  }
  if (testDouble) {
    if (reference.source !== 'test_double' || reference.conclusion_eligible !== false) {
      throw new TypeError(
        `Test-double boolean "${path}" must be marked source=test_double and conclusion_eligible=false.`,
      );
    }
    return;
  }

  const expectedBinding = SOURCE_BINDINGS[reference.source];
  if (!expectedBinding || reference.binding !== expectedBinding) {
    throw new TypeError(`Boolean observation "${path}" has unsupported provenance source/binding.`);
  }
  if (typeof reference.locator !== 'string' || !reference.locator.startsWith('/')) {
    throw new TypeError(`Boolean observation "${path}" provenance requires a JSON Pointer locator.`);
  }
  if (reference.sha256 !== bindingDigests[expectedBinding]) {
    throw new TypeError(`Boolean observation "${path}" provenance digest is not attestation-bound.`);
  }
  if (!resolvePointer(bindingDocuments[expectedBinding], reference.locator).found) {
    throw new TypeError(`Boolean observation "${path}" provenance locator does not exist in source evidence.`);
  }
}

function readTestDouble(path) {
  if (!path) throw new TypeError('Test-double mode requires observation or observationPath.');
  return parseJsonFile(path, 'test-double observation');
}

function parseJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new TypeError(`Cannot parse ${label} JSON: ${error.message}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function escapePointer(value) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function resolvePointer(document, pointer) {
  if (pointer === '') return { found: true, value: document };
  if (!pointer.startsWith('/')) return { found: false };
  let value = document;
  for (const token of pointer.slice(1).split('/').map(unescapePointer)) {
    if (
      value == null
      || typeof value !== 'object'
      || !Object.prototype.hasOwnProperty.call(value, token)
    ) {
      return { found: false };
    }
    value = value[token];
  }
  return { found: true, value };
}

function unescapePointer(value) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}
