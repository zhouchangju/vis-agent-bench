import {
  validateMemoryExperimentSpec,
  validateMemoryFeedback,
  validateMemoryIntervention,
  validateMemoryPairedReport,
} from './contracts.mjs';

const EVIDENCE_REF = /^(?:run|artifact)_[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function invalid(message, details = []) {
  const error = new Error(message);
  error.code = 'INVALID_MEMORY_PAIR';
  error.details = details;
  return error;
}

function validateRun(run, label) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw invalid(`${label} run must be an object.`);
  const spec = validateMemoryExperimentSpec(run.experimentSpec);
  const intervention = validateMemoryIntervention(run.intervention);
  const details = [
    ...spec.errors.map(error => ({ ...error, path: `${label}.experimentSpec${error.path.slice(1)}` })),
    ...intervention.errors.map(error => ({ ...error, path: `${label}.intervention${error.path.slice(1)}` })),
  ];
  if (!run.execution || typeof run.execution !== 'object' || Array.isArray(run.execution)) {
    details.push({ path: `${label}.execution`, code: 'OBJECT', message: 'execution must be an object.' });
  } else {
    const executionFields = ['sessionId', 'workspaceId'];
    for (const field of executionFields) {
      const value = run.execution[field];
      if (typeof value !== 'string'
        || value.length === 0
        || value.length > 128
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
        details.push({ path: `${label}.execution.${field}`, code: 'ID_PATTERN', message: `${field} must be a bounded execution identifier.` });
      }
    }
    for (const field of Object.keys(run.execution)) {
      if (!executionFields.includes(field)) details.push({ path: `${label}.execution.${field}`, code: 'UNEXPECTED_FIELD', message: 'Field is not allowed.' });
    }
  }
  if (!Array.isArray(run.feedback)) {
    details.push({ path: `${label}.feedback`, code: 'ARRAY', message: 'feedback must be an array.' });
  } else if (intervention.valid) {
    run.feedback.forEach((entry, index) => {
      const result = validateMemoryFeedback(entry, { intervention: run.intervention });
      details.push(...result.errors.map(error => ({ ...error, path: `${label}.feedback[${index}]${error.path.slice(1)}` })));
    });
  }
  if (!run.result || typeof run.result !== 'object' || Array.isArray(run.result)) {
    details.push({ path: `${label}.result`, code: 'OBJECT', message: 'result must be an object.' });
  } else {
    if (!['success', 'failed'].includes(run.result.status)) {
      details.push({ path: `${label}.result.status`, code: 'ENUM', message: 'status must be success or failed.' });
    }
    if (!Array.isArray(run.result.evidenceRefs)
      || run.result.evidenceRefs.length === 0
      || new Set(run.result.evidenceRefs).size !== run.result.evidenceRefs.length
      || run.result.evidenceRefs.some(ref => typeof ref !== 'string' || !EVIDENCE_REF.test(ref))) {
      details.push({ path: `${label}.result.evidenceRefs`, code: 'EVIDENCE_REQUIRED', message: 'at least one result evidence reference is required.' });
    }
    for (const field of ['qualityScore', 'durationMs', 'costUsd']) {
      if (run.result[field] !== null
        && (typeof run.result[field] !== 'number' || !Number.isFinite(run.result[field]) || run.result[field] < 0)) {
        details.push({ path: `${label}.result.${field}`, code: 'NULLABLE_NUMBER', message: `${field} must be a non-negative number or null.` });
      }
    }
  }
  if (Array.isArray(run.feedback) && run.result?.evidenceRefs) {
    const resultEvidence = new Set(run.result.evidenceRefs);
    run.feedback.forEach((entry, index) => {
      const foreign = entry.evidenceRefs?.filter(ref => !resultEvidence.has(ref)) || [];
      if (foreign.length) {
        details.push({
          path: `${label}.feedback[${index}].evidenceRefs`,
          code: 'EVIDENCE_OWNERSHIP',
          message: `feedback evidence must belong to the same arm result: ${foreign.join(', ')}`,
        });
      }
    });
  }
  if (details.length) throw invalid(`${label} run is invalid.`, details);

  for (const field of ['experimentId', 'projectId', 'taskId']) {
    if (run.intervention[field] !== run.experimentSpec[field]) {
      throw invalid(`${label} intervention ${field} does not match experimentSpec.`);
    }
  }
}

function metricDelta(approvedValue, offValue, unit, eligible) {
  if (!eligible) {
    return { availability: 'unavailable', value: null, unit, reason: 'one_or_both_arms_ineligible' };
  }
  if (typeof approvedValue !== 'number' || typeof offValue !== 'number') {
    return { availability: 'unavailable', value: null, unit, reason: 'one_or_both_arms_missing' };
  }
  return {
    availability: 'reported',
    value: Number((approvedValue - offValue).toFixed(6)),
    unit,
    direction: 'approved_only_minus_off',
  };
}

export function buildMemoryPairedReport(first, second, { generatedAt = new Date().toISOString() } = {}) {
  validateRun(first, 'first');
  validateRun(second, 'second');
  if (first.intervention.arm === second.intervention.arm) throw invalid('Pair must contain different arms.');

  const byArm = {
    [first.intervention.arm]: first,
    [second.intervention.arm]: second,
  };
  const off = byArm.off;
  const approved = byArm.approved_only;
  if (!off || !approved) throw invalid('Pair must contain off and approved_only arms.');

  for (const field of ['experimentId', 'projectId', 'taskId']) {
    if (off.experimentSpec[field] !== approved.experimentSpec[field]) {
      throw invalid(`Pair ${field} mismatch.`);
    }
  }
  if (stable(off.experimentSpec.controls) !== stable(approved.experimentSpec.controls)) {
    throw invalid('Pair control variables differ.', [{
      path: '$.experimentSpec.controls',
      code: 'CONTROL_MISMATCH',
      message: 'model, engine, tools, budget, baseCommit, and fixtureHash must match.',
    }]);
  }
  if (off.intervention.policyVersion !== approved.intervention.policyVersion) {
    throw invalid('Pair policyVersion mismatch.');
  }
  if (off.intervention.interventionId === approved.intervention.interventionId) {
    throw invalid('Pair interventionId values must be distinct.');
  }
  if (off.intervention.retrievalRunId === approved.intervention.retrievalRunId) {
    throw invalid('Pair retrievalRunId values must be distinct.');
  }
  if (off.execution.sessionId === approved.execution.sessionId) {
    throw invalid('Pair sessionId values must be distinct to prove fresh sessions.');
  }
  if (off.execution.workspaceId === approved.execution.workspaceId) {
    throw invalid('Pair workspaceId values must be distinct to prove independent workspaces.');
  }
  const feedbackIds = [...off.feedback, ...approved.feedback].map(entry => entry.feedbackId);
  if (new Set(feedbackIds).size !== feedbackIds.length) {
    throw invalid('Pair feedbackId values must be unique across arms.');
  }
  const sharedRunEvidence = off.result.evidenceRefs.filter(ref => approved.result.evidenceRefs.includes(ref));
  if (sharedRunEvidence.length) {
    throw invalid('Pair reuses arm result evidence, indicating cross-arm contamination.', [{
      path: '$.result.evidenceRefs',
      code: 'EVIDENCE_CONTAMINATION',
      message: `Arm result evidence must be independent: ${sharedRunEvidence.join(', ')}`,
    }]);
  }

  const allFeedback = [...off.feedback, ...approved.feedback];
  const feedbackCounts = { helpful: 0, neutral: 0, harmful: 0, unobserved: 0 };
  for (const feedback of allFeedback) feedbackCounts[feedback.outcome] += 1;
  const selected = approved.intervention.selectedMemoryIds;
  const observedIds = new Set(
    approved.feedback
      .filter(entry => entry.memoryId !== null && entry.outcome !== 'unobserved')
      .map(entry => entry.memoryId),
  );
  const utilization = selected.length === 0
    ? {
        availability: 'unavailable',
        selectedCount: 0,
        observedCount: 0,
        rate: null,
        reason: 'no_selected_memories',
      }
    : {
        availability: 'reported',
        selectedCount: selected.length,
        observedCount: observedIds.size,
        rate: Number((observedIds.size / selected.length).toFixed(6)),
      };
  const evidenceRefs = [...new Set([
    ...off.result.evidenceRefs,
    ...approved.result.evidenceRefs,
    ...allFeedback.flatMap(entry => entry.evidenceRefs),
  ])].sort();
  const eligible = off.result.status === 'success' && approved.result.status === 'success';
  const armControls = Object.fromEntries(
    Object.keys(off.experimentSpec.controls).sort().map(field => [field, 'matched']),
  );

  const report = {
    schemaVersion: 1,
    experimentId: off.experimentSpec.experimentId,
    projectId: off.experimentSpec.projectId,
    taskId: off.experimentSpec.taskId,
    comparisonStatus: eligible ? 'eligible' : 'ineligible',
    armControls,
    arms: {
      off: {
        interventionId: off.intervention.interventionId,
        retrievalRunId: off.intervention.retrievalRunId,
        contextPackHash: null,
        selectedMemoryIds: [],
        resultStatus: off.result.status,
        sessionId: off.execution.sessionId,
        workspaceId: off.execution.workspaceId,
      },
      approved_only: {
        interventionId: approved.intervention.interventionId,
        retrievalRunId: approved.intervention.retrievalRunId,
        contextPackHash: approved.intervention.contextPackHash,
        selectedMemoryIds: [...selected],
        resultStatus: approved.result.status,
        sessionId: approved.execution.sessionId,
        workspaceId: approved.execution.workspaceId,
      },
    },
    controls: structuredClone(off.experimentSpec.controls),
    feedbackCounts,
    utilization,
    deltas: {
      quality: metricDelta(approved.result.qualityScore, off.result.qualityScore, 'score', eligible),
      time: metricDelta(approved.result.durationMs, off.result.durationMs, 'ms', eligible),
      cost: metricDelta(approved.result.costUsd, off.result.costUsd, 'USD', eligible),
    },
    evidenceRefs,
    generatedAt,
  };
  const validation = validateMemoryPairedReport(report);
  if (!validation.valid) throw invalid('Generated MemoryPairedReport is invalid.', validation.errors);
  return report;
}
