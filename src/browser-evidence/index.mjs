import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateCaptureSpec, CAPTURE_SPEC } from './capture-spec.mjs';
import { getDriver, listDrivers, registerDriver, setDefaultDriverName, createStaticFixtureDriver } from './driver.mjs';
import { validateEvidencePackage, redactForBlindReview, BLIND_REVIEW_HIDDEN_FIELDS } from './evidence-package.mjs';
import { structuredError, coerceError, isStructuredError, ERROR_CODES } from './errors.mjs';

export {
  CAPTURE_SPEC,
  validateCaptureSpec,
};

export {
  getDriver,
  listDrivers,
  registerDriver,
  setDefaultDriverName,
  createStaticFixtureDriver,
};

export {
  validateEvidencePackage,
  redactForBlindReview,
  BLIND_REVIEW_HIDDEN_FIELDS,
};

export {
  structuredError,
  coerceError,
  isStructuredError,
  ERROR_CODES,
};

/**
 * Run the full browser-evidence pipeline for a capture spec object.
 *
 * Steps:
 *   1. Validate the spec.
 *   2. Select the driver (default `static-fixture`).
 *   3. Run capture, writing artifacts via the optional `writeArtifact` callback.
 *   4. Validate the produced evidence package.
 *
 * Returns a structured result envelope with `status`, `summary`,
 * `next_actions`, `artifacts`, plus `evidence` (the package) and `errors`.
 */
export async function runCapture(input, options = {}) {
  const root = options.root ?? process.cwd();
  const driverName = options.driver ?? 'static-fixture';
  const outDir = options.outDir ?? null;
  const writeArtifact = options.writeArtifact ?? defaultWriteArtifact;
  const validation = validateCaptureSpec(input, { root });
  if (!validation.valid) {
    return {
      status: 'error',
      summary: `Capture spec is invalid: ${validation.errors.length} issue(s).`,
      next_actions: ['Fix the capture spec and retry.'],
      artifacts: [],
      errors: validation.errors,
      evidence: null,
    };
  }
  let driver;
  try {
    driver = getDriver(driverName);
  } catch (error) {
    const structured = error.structured ?? structuredError('DRIVER_UNAVAILABLE', error.message, { requested: driverName });
    return {
      status: 'error',
      summary: structured.message,
      next_actions: ['Register or install the requested browser-evidence driver.'],
      artifacts: [],
      errors: [structured],
      evidence: null,
    };
  }
  let evidence;
  try {
    evidence = await driver.capture(validation.spec, { outDir, writeArtifact });
  } catch (error) {
    const structured = coerceError(error, 'CAPTURE_INCOMPLETE');
    return {
      status: 'error',
      summary: structured.message,
      next_actions: ['Inspect the structured failure and rerun with a narrower capture spec.'],
      artifacts: [],
      errors: [structured],
      evidence: null,
    };
  }
  const result = validateEvidencePackage(evidence);
  if (!result.valid) {
    return {
      status: 'error',
      summary: `Driver produced an invalid evidence package: ${result.errors.length} issue(s).`,
      next_actions: ['The driver implementation must be fixed; do not retry with the same spec.'],
      artifacts: outDir ? [`${outDir}/browser-evidence.json`] : [],
      errors: result.errors,
      evidence,
    };
  }
  const status = evidence.status === 'success' ? 'success' : (evidence.status === 'warning' ? 'warning' : 'error');
  return {
    status,
    summary: status === 'success'
      ? `Captured browser evidence for ${evidence.case_id} (${evidence.screenshots.length} screenshot(s), ${evidence.dom_snapshots.length} DOM snapshot(s)).`
      : `Captured browser evidence for ${evidence.case_id} with ${evidence.failures.length} structured failure(s).`,
    next_actions: status === 'success' ? [] : evidence.failures.map(f => `${f.code}: ${f.message}`),
    artifacts: outDir ? [`${outDir}/browser-evidence.json`] : [],
    errors: evidence.failures,
    evidence,
  };
}

function defaultWriteArtifact(outDir, name, buffer) {
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, name);
  writeFileSync(target, buffer);
  return target;
}
