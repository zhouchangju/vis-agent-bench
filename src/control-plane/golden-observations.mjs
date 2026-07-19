import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { collectBooleanPaths } from '../evaluators/control/observation-attestation.mjs';
import { createMinimalCompliantObservation } from '../../tests/evaluators/macro-map-3d/samples.mjs';

export function loadGoldenObservation(projectRoot, caseId, browserEvidence) {
  let observation;
  if (caseId === 'macro-map-3d-greenfield') {
    observation = createMinimalCompliantObservation(browserEvidence);
  } else if (caseId === 'narrative-equity-relationship') {
    observation = readJson(join(
      projectRoot,
      'tests/evaluators/narrative-equity/samples/minimal-compliant.json',
    ));
  } else if (caseId === 'ainvest-market-heatmap-rebuild') {
    observation = readJson(join(
      projectRoot,
      'tests/evaluators/ainvest-heatmap/samples/minimal-compliant.json',
    ));
    observation.browserEvidence = browserEvidence;
  } else {
    throw new Error(`No deterministic golden observation for ${caseId}.`);
  }
  return observation;
}

export function attachProductionProvenance(observation, digests) {
  const output = structuredClone(observation);
  output.provenance = {
    boolean_facts: Object.fromEntries(collectBooleanPaths(output).map(path => {
      const source = path.startsWith('/commands/')
        ? 'command'
        : path.startsWith('/dsl/') || path.startsWith('/inputs/') || path.startsWith('/input/')
          ? 'hidden_control'
          : 'browser_state';
      const binding = source === 'command'
        ? 'command_evidence'
        : source === 'hidden_control'
          ? 'hidden_control_execution'
          : 'browser_evidence';
      return [path, [{
        source,
        binding,
        locator: path,
        sha256: digests[binding],
      }]];
    })),
  };
  return output;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
