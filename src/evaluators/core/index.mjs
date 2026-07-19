// Public surface of Evaluator Core.
//
// Case-specific evaluators (VAB-T05+) build on top of these primitives.
// They register deterministic checks, declare a rubric, and call
// runEvaluation(); everything else — execution isolation, scoring, caps,
// evidence packaging — is handled here.

export { STATUS, isStatus, isExecuted, isHarnessStatus, isPassing, isBlocking, isHarnessFault, describeStatus } from './status.mjs';
export { defineCheck, createExecutionContext, normaliseOutcome, harnessErrorResult, skippedResult, attachExecutorEvidence } from './check.mjs';
export { runCheck, runCommandEvidence, writeArtifact } from './runner.mjs';
export { normaliseRubric, scoreEvaluation } from './scoring.mjs';
export { createEvidenceBundle, summariseBundle, partitionByFailureSource } from './evidence.mjs';
export { runEvaluation, declareCheck } from './lifecycle.mjs';

export const EVALUATOR_CORE_VERSION = 'v1';
