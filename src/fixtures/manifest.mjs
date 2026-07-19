import { createHash } from 'node:crypto';

/**
 * Fixture manifest contract.
 *
 * A manifest is the single machine-readable record of *what* a fixture
 * contains, *where* it came from, and *which* gates it passed. It is what the
 * Runner checks at preflight and what the report cites as provenance.
 *
 * The manifest never contains answer material: file bodies are hashed, never
 * embedded. Canary names listed in `leakage_rule_set_digest` are also hashed
 * — the literal markers stay on the control plane.
 */

export const MANIFEST_VERSION = 1;

/**
 * @typedef {Object} ManifestInput
 * @property {string} case_id
 * @property {string} fixture_root               Absolute path of the exported workspace.
 * @property {string} [source_descriptor]        Case-declared human description of the source.
 * @property {string} source_type                observed | inferred | proposed | synthetic
 * @property {Array<ManifestProvenanceEntry>} provenance
 * @property {Array<ManifestFileEntry>} files
 * @property {{ path?: number, content?: number, canary?: number }} leakage_finding_counts
 * @property {string} leakage_rule_set_digest    SHA-256 of the applied rule set.
 * @property {ManifestBaselineResult} baseline
 * @property {ManifestExport} export
 * @property {Array<string>} [notes]
 */

/**
 * @typedef {Object} ManifestProvenanceEntry
 * @property {'repository' | 'generated' | 'public-dataset' | 'manual' | 'placeholder'} kind
 * @property {string} label
 * @property {string} [ref]                     Commit hash / archive id / generator name — opaque to the manifest.
 * @property {string} [digest]                  SHA-256 of source material when it can be hashed (e.g. archive).
 * @property {string} [source_type]             observed | inferred | proposed | synthetic
 * @property {boolean} [modified]               True if the builder applied a compile-clean patch.
 */

/**
 * @typedef {Object} ManifestFileEntry
 * @property {string} file                       Relative path inside fixture_root.
 * @property {number} bytes
 * @property {string} sha256
 * @property {string} [category]                 scaffold | data | asset | config | public-doc
 */

/**
 * @typedef {Object} ManifestBaselineResult
 * @property {'passed' | 'failed' | 'skipped'} status
 * @property {Array<{ name: string, command: Array<string>, status: 'passed'|'failed'|'skipped', duration_ms: number, exit_code: number|null, log_path: string|null }>} steps
 * @property {string} started_at                 ISO timestamp.
 * @property {string} ended_at                   ISO timestamp.
 * @property {number} duration_ms
 */

/**
 * @typedef {Object} ManifestExport
 * @property {string} fixture_root
 * @property {string} fixture_digest             SHA-256 over the sorted file list with hashes.
 * @property {'prepared' | 'verified' | 'rejected'} status
 * @property {string} produced_at                ISO timestamp.
 * @property {string} builder_version
 * @property {{ [key: string]: string }} environment   e.g. { node: 'v20.x', platform: 'darwin' }
 */

/**
 * Compute a deterministic digest over a file listing so that two builds with
 * identical inputs produce the same fixture digest. Order-stable and path-
 * stable: sort by file path, then concatenate `path|bytes|sha256` lines.
 *
 * @param {Array<ManifestFileEntry>} files
 * @returns {string} sha256 hex digest
 */
export function computeFixtureDigest(files) {
  const sorted = [...files].sort((a, b) => a.file.localeCompare(b.file));
  const payload = sorted
    .map(entry => `${entry.file}|${entry.bytes}|${entry.sha256}`)
    .join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Serialise a manifest deterministically (stable key order, 2-space indent).
 *
 * Accepts either of two equivalent input shapes:
 *   - canonical: { leakage: { rule_set_digest, finding_counts } }
 *   - legacy:    { leakage_rule_set_digest, leakage_finding_counts }
 * The canonical shape is always what is written to disk.
 */
export function serialiseManifest(manifest) {
  const leakage = manifest.leakage || {};
  const ruleSetDigest = leakage.rule_set_digest ?? manifest.leakage_rule_set_digest;
  const findingCounts = leakage.finding_counts ?? manifest.leakage_finding_counts ?? {};
  const canonical = {
    manifest_version: MANIFEST_VERSION,
    case_id: manifest.case_id,
    source_descriptor: manifest.source_descriptor ?? null,
    source_type: manifest.source_type,
    provenance: manifest.provenance,
    leakage: {
      rule_set_digest: ruleSetDigest,
      finding_counts: {
        path: findingCounts.path ?? 0,
        content: findingCounts.content ?? 0,
        canary: findingCounts.canary ?? 0,
      },
    },
    baseline: manifest.baseline,
    files: [...manifest.files].sort((a, b) => a.file.localeCompare(b.file)),
    export: manifest.export,
    notes: manifest.notes ?? [],
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}

/**
 * Validate the shape of a manifest object. Used by both the builder (before
 * publishing) and the Runner (before consuming). Returns a list of issues;
 * an empty list means the manifest is structurally valid.
 *
 * @param {unknown} value
 * @returns {Array<{ path: string, message: string }>}
 */
export function validateManifest(value) {
  const issues = [];
  if (value == null || typeof value !== 'object') {
    return [{ path: '$', message: 'Manifest must be an object.' }];
  }
  const m = value;
  if (m.manifest_version !== MANIFEST_VERSION) {
    issues.push({ path: '$.manifest_version', message: `manifest_version must equal ${MANIFEST_VERSION}.` });
  }
  for (const field of ['case_id', 'source_type']) {
    if (typeof m[field] !== 'string' || m[field].length === 0) {
      issues.push({ path: `$.${field}`, message: `${field} must be a non-empty string.` });
    }
  }
  if (!Array.isArray(m.provenance)) {
    issues.push({ path: '$.provenance', message: 'provenance must be an array.' });
  } else {
    m.provenance.forEach((entry, index) => {
      const base = `$.provenance[${index}]`;
      if (entry == null || typeof entry !== 'object') {
        issues.push({ path: base, message: 'provenance entry must be an object.' });
        return;
      }
      if (!['repository', 'generated', 'public-dataset', 'manual', 'placeholder'].includes(entry.kind)) {
        issues.push({ path: `${base}.kind`, message: 'provenance.kind has an unsupported value.' });
      }
      if (typeof entry.label !== 'string' || entry.label.length === 0) {
        issues.push({ path: `${base}.label`, message: 'provenance.label must be a non-empty string.' });
      }
    });
  }
  if (!Array.isArray(m.files)) {
    issues.push({ path: '$.files', message: 'files must be an array.' });
  } else {
    m.files.forEach((entry, index) => {
      const base = `$.files[${index}]`;
      if (entry == null || typeof entry !== 'object') {
        issues.push({ path: base, message: 'file entry must be an object.' });
        return;
      }
      if (typeof entry.file !== 'string' || entry.file.length === 0) {
        issues.push({ path: `${base}.file`, message: 'file path must be a non-empty string.' });
      }
      if (typeof entry.bytes !== 'number' || entry.bytes < 0) {
        issues.push({ path: `${base}.bytes`, message: 'bytes must be a non-negative number.' });
      }
      if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        issues.push({ path: `${base}.sha256`, message: 'sha256 must be a 64-char hex digest.' });
      }
    });
  }
  if (!m.leakage || typeof m.leakage !== 'object') {
    issues.push({ path: '$.leakage', message: 'leakage block is required.' });
  } else {
    if (typeof m.leakage.rule_set_digest !== 'string' || !/^[0-9a-f]{64}$/.test(m.leakage.rule_set_digest)) {
      issues.push({ path: '$.leakage.rule_set_digest', message: 'rule_set_digest must be a 64-char hex digest.' });
    }
  }
  if (!m.export || typeof m.export !== 'object') {
    issues.push({ path: '$.export', message: 'export block is required.' });
  } else {
    if (typeof m.export.fixture_digest !== 'string' || !/^[0-9a-f]{64}$/.test(m.export.fixture_digest)) {
      issues.push({ path: '$.export.fixture_digest', message: 'fixture_digest must be a 64-char hex digest.' });
    }
    if (!['prepared', 'verified', 'rejected'].includes(m.export.status)) {
      issues.push({ path: '$.export.status', message: 'export.status has an unsupported value.' });
    }
  }
  return issues;
}
