const ARMS = new Set(['off', 'approved_only']);
const OUTCOMES = new Set(['helpful', 'neutral', 'harmful', 'unobserved']);
const SHA256 = /^[a-f0-9]{64}$/;
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const PROJECT_ID = /^project_[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const TASK_ID = /^task_[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const INTERVENTION_ID = /^memory_intervention_[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const RETRIEVAL_RUN_ID = /^memory_retrieval_[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const FEEDBACK_ID = /^memory_feedback_[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MEMORY_ID = /^memory_(?!(?:intervention|retrieval|feedback)_)[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EVIDENCE_REF = /^(?:run|artifact)_[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function issue(path, code, message) {
  return { path, code, message };
}

function object(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringList(value, { max = Infinity } = {}) {
  return Array.isArray(value)
    && value.length <= max
    && value.every(text)
    && new Set(value).size === value.length;
}

function isoDate(value) {
  if (!text(value)) return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/,
  );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1]
    && Number(hourText) <= 23
    && Number(minuteText) <= 59
    && Number(secondText) <= 59
    && (offsetHourText === undefined || Number(offsetHourText) <= 23)
    && (offsetMinuteText === undefined || Number(offsetMinuteText) <= 59);
}

function required(value, fields, errors) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) errors.push(issue(`$.${field}`, 'REQUIRED', 'Field is required.'));
  }
}

function only(value, fields, errors) {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(issue(`$.${field}`, 'UNEXPECTED_FIELD', 'Field is not allowed.'));
  }
}

function finish(value, errors) {
  return { valid: errors.length === 0, errors, value: errors.length ? null : value };
}

function idMatches(pattern, value) {
  return typeof value === 'string' && value.length <= 128 && pattern.test(value);
}

function validateExternalIdentity(value, errors) {
  if (!idMatches(EXTERNAL_ID, value.experimentId)) errors.push(issue('$.experimentId', 'ID_PATTERN', 'experimentId is invalid.'));
  if (!idMatches(PROJECT_ID, value.projectId)) errors.push(issue('$.projectId', 'ID_PATTERN', 'projectId must use the project_ namespace.'));
  if (!idMatches(TASK_ID, value.taskId)) errors.push(issue('$.taskId', 'ID_PATTERN', 'taskId must use the task_ namespace.'));
}

export function validateMemoryExperimentSpec(value) {
  const errors = [];
  if (!object(value)) return finish(value, [issue('$', 'OBJECT', 'MemoryExperimentSpec must be an object.')]);
  const fields = ['schemaVersion', 'experimentId', 'projectId', 'taskId', 'arms', 'controls', 'createdAt'];
  required(value, fields, errors);
  only(value, fields, errors);
  if (value.schemaVersion !== 1) errors.push(issue('$.schemaVersion', 'CONST', 'schemaVersion must be 1.'));
  validateExternalIdentity(value, errors);
  if (!Array.isArray(value.arms)
    || value.arms.length !== 2
    || value.arms[0] !== 'off'
    || value.arms[1] !== 'approved_only') {
    errors.push(issue('$.arms', 'ARM_SET', 'arms must be exactly ["off", "approved_only"].'));
  }
  validateControls(value.controls, errors);
  if (!isoDate(value.createdAt)) errors.push(issue('$.createdAt', 'DATE_TIME', 'createdAt must be an ISO date-time.'));
  return finish(value, errors);
}

function validateControls(value, errors) {
  if (!object(value)) {
    errors.push(issue('$.controls', 'OBJECT', 'controls must be an object.'));
    return;
  }
  const fields = ['caseId', 'caseVersion', 'model', 'provider', 'engine', 'reasoningEffort', 'tools', 'budget', 'baseCommit', 'fixtureHash', 'memorySnapshotHash'];
  required(value, fields, errors);
  only(value, fields, errors);
  for (const field of ['caseId', 'caseVersion', 'model', 'provider', 'engine']) {
    if (!text(value[field])) errors.push(issue(`$.controls.${field}`, 'STRING', `${field} must be non-empty.`));
  }
  if (value.reasoningEffort !== null && !text(value.reasoningEffort)) {
    errors.push(issue('$.controls.reasoningEffort', 'NULLABLE_STRING', 'reasoningEffort must be null or non-empty.'));
  }
  if (!stringList(value.tools)) errors.push(issue('$.controls.tools', 'STRING_ARRAY', 'tools must be unique non-empty strings.'));
  validateMemoryBudget(value.budget, errors);
  if (typeof value.baseCommit !== 'string' || !/^[a-fA-F0-9]{7,64}$/.test(value.baseCommit)) {
    errors.push(issue('$.controls.baseCommit', 'GIT_HASH', 'baseCommit must be a 7-64 character Git hash.'));
  }
  if (!SHA256.test(value.fixtureHash || '')) errors.push(issue('$.controls.fixtureHash', 'SHA256', 'fixtureHash must be lowercase SHA-256 hex.'));
  if (!SHA256.test(value.memorySnapshotHash || '')) errors.push(issue('$.controls.memorySnapshotHash', 'SHA256', 'memorySnapshotHash must be lowercase SHA-256 hex.'));
}

function validateMemoryBudget(value, errors) {
  if (!object(value)) {
    errors.push(issue('$.controls.budget', 'OBJECT', 'budget must be an object.'));
    return;
  }
  const fields = ['wallTimeMinutes', 'maxRetries', 'maxTokens', 'maxCostUsd'];
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) errors.push(issue(`$.controls.budget.${field}`, 'REQUIRED', 'Field is required.'));
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) errors.push(issue(`$.controls.budget.${field}`, 'UNEXPECTED_FIELD', 'Field is not allowed.'));
  }
  if (typeof value.wallTimeMinutes !== 'number' || !Number.isFinite(value.wallTimeMinutes) || value.wallTimeMinutes <= 0) {
    errors.push(issue('$.controls.budget.wallTimeMinutes', 'POSITIVE_NUMBER', 'wallTimeMinutes must be positive.'));
  }
  if (!Number.isInteger(value.maxRetries) || value.maxRetries < 0) {
    errors.push(issue('$.controls.budget.maxRetries', 'NONNEGATIVE_INTEGER', 'maxRetries must be a non-negative integer.'));
  }
  if (value.maxTokens !== null && (!Number.isInteger(value.maxTokens) || value.maxTokens <= 0)) {
    errors.push(issue('$.controls.budget.maxTokens', 'NULLABLE_POSITIVE_INTEGER', 'maxTokens must be null or a positive integer.'));
  }
  if (value.maxCostUsd !== null
    && (typeof value.maxCostUsd !== 'number' || !Number.isFinite(value.maxCostUsd) || value.maxCostUsd < 0)) {
    errors.push(issue('$.controls.budget.maxCostUsd', 'NULLABLE_NONNEGATIVE_NUMBER', 'maxCostUsd must be null or non-negative.'));
  }
}

export function validateMemoryIntervention(value) {
  const errors = [];
  if (!object(value)) return finish(value, [issue('$', 'OBJECT', 'MemoryIntervention must be an object.')]);
  const fields = [
    'schemaVersion', 'interventionId', 'retrievalRunId', 'experimentId', 'projectId', 'taskId',
    'arm', 'policyVersion', 'contextPackHash', 'selectedMemoryIds', 'createdAt',
  ];
  required(value, fields, errors);
  only(value, fields, errors);
  if (value.schemaVersion !== 1) errors.push(issue('$.schemaVersion', 'CONST', 'schemaVersion must be 1.'));
  validateExternalIdentity(value, errors);
  if (!idMatches(EXTERNAL_ID, value.policyVersion)) errors.push(issue('$.policyVersion', 'ID_PATTERN', 'policyVersion is invalid.'));
  if (!idMatches(INTERVENTION_ID, value.interventionId)) errors.push(issue('$.interventionId', 'ID_PATTERN', 'interventionId must start with memory_intervention_.'));
  if (!idMatches(RETRIEVAL_RUN_ID, value.retrievalRunId)) errors.push(issue('$.retrievalRunId', 'ID_PATTERN', 'retrievalRunId must start with memory_retrieval_.'));
  if (!ARMS.has(value.arm)) errors.push(issue('$.arm', 'ENUM', 'arm must be off or approved_only.'));
  if (!stringList(value.selectedMemoryIds, { max: 3 })) {
    errors.push(issue('$.selectedMemoryIds', 'MEMORY_IDS', 'selectedMemoryIds must contain at most three unique non-empty ids.'));
  } else if (value.selectedMemoryIds.some(id => !idMatches(MEMORY_ID, id))) {
    errors.push(issue('$.selectedMemoryIds', 'ID_PATTERN', 'selected memory ids must start with memory_.'));
  }
  if (value.arm === 'off' && (value.contextPackHash !== null || value.selectedMemoryIds?.length !== 0)) {
    errors.push(issue('$', 'OFF_CONTAMINATION', 'off requires contextPackHash=null and no selected memories.'));
  }
  if (value.arm === 'approved_only' && !SHA256.test(value.contextPackHash || '')) {
    errors.push(issue('$.contextPackHash', 'SHA256', 'approved_only requires a Context Pack SHA-256 hash, including for an empty pack.'));
  }
  if (!isoDate(value.createdAt)) errors.push(issue('$.createdAt', 'DATE_TIME', 'createdAt must be an ISO date-time.'));
  return finish(value, errors);
}

export function validateMemoryFeedback(value, { intervention } = {}) {
  const errors = [];
  if (!object(value)) return finish(value, [issue('$', 'OBJECT', 'MemoryFeedback must be an object.')]);
  const fields = [
    'schemaVersion', 'feedbackId', 'interventionId', 'memoryId',
    'outcome', 'evidenceRefs', 'note', 'createdAt',
  ];
  required(value, fields, errors);
  only(value, fields, errors);
  if (value.schemaVersion !== 1) errors.push(issue('$.schemaVersion', 'CONST', 'schemaVersion must be 1.'));
  if (!idMatches(FEEDBACK_ID, value.feedbackId)) errors.push(issue('$.feedbackId', 'ID_PATTERN', 'feedbackId must start with memory_feedback_.'));
  if (!idMatches(INTERVENTION_ID, value.interventionId)) errors.push(issue('$.interventionId', 'ID_PATTERN', 'interventionId must start with memory_intervention_.'));
  if (value.memoryId !== null && !idMatches(MEMORY_ID, value.memoryId)) errors.push(issue('$.memoryId', 'ID_PATTERN', 'memoryId must be null or start with memory_.'));
  if (!OUTCOMES.has(value.outcome)) errors.push(issue('$.outcome', 'ENUM', 'outcome is invalid.'));
  if (!stringList(value.evidenceRefs)
    || value.evidenceRefs.length === 0
    || value.evidenceRefs.some(ref => !idMatches(EVIDENCE_REF, ref))) {
    errors.push(issue('$.evidenceRefs', 'EVIDENCE_REQUIRED', 'evidenceRefs must contain at least one unique run_ or artifact_ reference.'));
  }
  if (!text(value.note) || value.note.length > 10_000) errors.push(issue('$.note', 'STRING', 'note must contain 1-10000 characters.'));
  if (!isoDate(value.createdAt)) errors.push(issue('$.createdAt', 'DATE_TIME', 'createdAt must be an ISO date-time.'));
  if (intervention) {
    if (value.interventionId !== intervention.interventionId) {
      errors.push(issue('$.interventionId', 'INTERVENTION_MISMATCH', 'feedback must reference its intervention.'));
    }
    if (value.memoryId !== null && !intervention.selectedMemoryIds.includes(value.memoryId)) {
      errors.push(issue('$.memoryId', 'UNSELECTED_MEMORY', 'memoryId must belong to selectedMemoryIds; use null for intervention-level feedback.'));
    }
  }
  return finish(value, errors);
}

export function validateMemoryPairedReport(value) {
  const errors = [];
  if (!object(value)) return finish(value, [issue('$', 'OBJECT', 'MemoryPairedReport must be an object.')]);
  const fields = [
    'schemaVersion', 'experimentId', 'projectId', 'taskId', 'comparisonStatus', 'armControls', 'arms', 'controls',
    'feedbackCounts', 'utilization', 'deltas', 'evidenceRefs', 'generatedAt',
  ];
  required(value, fields, errors);
  only(value, fields, errors);
  if (value.schemaVersion !== 1) errors.push(issue('$.schemaVersion', 'CONST', 'schemaVersion must be 1.'));
  validateExternalIdentity(value, errors);
  if (!['eligible', 'ineligible'].includes(value.comparisonStatus)) {
    errors.push(issue('$.comparisonStatus', 'ENUM', 'comparisonStatus must be eligible or ineligible.'));
  }
  const expectedControlKeys = object(value.controls) ? Object.keys(value.controls).sort() : [];
  if (!object(value.armControls)
    || JSON.stringify(Object.keys(value.armControls).sort()) !== JSON.stringify(expectedControlKeys)
    || Object.values(value.armControls).some(status => status !== 'matched')) {
    errors.push(issue('$.armControls', 'CONTROL_STATUS', 'armControls must record matched status for every accepted control.'));
  }
  if (!object(value.arms) || !object(value.arms.off) || !object(value.arms.approved_only)) {
    errors.push(issue('$.arms', 'ARMS', 'arms must contain off and approved_only objects.'));
  } else {
    const armFields = new Set(['interventionId', 'retrievalRunId', 'contextPackHash', 'selectedMemoryIds', 'resultStatus', 'sessionId', 'workspaceId']);
    for (const arm of ['off', 'approved_only']) {
      for (const field of Object.keys(value.arms[arm])) {
        if (!armFields.has(field)) errors.push(issue(`$.arms.${arm}.${field}`, 'UNEXPECTED_FIELD', 'Field is not allowed.'));
      }
    }
    if (value.arms.off.contextPackHash !== null || value.arms.off.selectedMemoryIds?.length !== 0) {
      errors.push(issue('$.arms.off', 'OFF_CONTAMINATION', 'off report arm must not contain a Context Pack or memories.'));
    }
    if (!SHA256.test(value.arms.approved_only.contextPackHash || '')) {
      errors.push(issue('$.arms.approved_only.contextPackHash', 'SHA256', 'approved_only report arm requires a Context Pack hash.'));
    }
    for (const arm of ['off', 'approved_only']) {
      for (const field of ['interventionId', 'retrievalRunId']) {
        const pattern = field === 'interventionId' ? INTERVENTION_ID : RETRIEVAL_RUN_ID;
        if (!idMatches(pattern, value.arms[arm][field])) errors.push(issue(`$.arms.${arm}.${field}`, 'ID_PATTERN', `${field} has an invalid prefix.`));
      }
      if (!['success', 'failed'].includes(value.arms[arm].resultStatus)) {
        errors.push(issue(`$.arms.${arm}.resultStatus`, 'ENUM', 'resultStatus must be success or failed.'));
      }
      for (const field of ['sessionId', 'workspaceId']) {
        if (!idMatches(EXTERNAL_ID, value.arms[arm][field])) {
          errors.push(issue(`$.arms.${arm}.${field}`, 'ID_PATTERN', `${field} must be a bounded execution identifier.`));
        }
      }
      if (!stringList(value.arms[arm].selectedMemoryIds, { max: 3 })) {
        errors.push(issue(`$.arms.${arm}.selectedMemoryIds`, 'MEMORY_IDS', 'selectedMemoryIds is invalid.'));
      } else if (value.arms[arm].selectedMemoryIds.some(id => !idMatches(MEMORY_ID, id))) {
        errors.push(issue(`$.arms.${arm}.selectedMemoryIds`, 'ID_PATTERN', 'selected memory ids must start with memory_.'));
      }
    }
  }
  if (object(value.arms)
    && value.arms.off?.sessionId === value.arms.approved_only?.sessionId) {
    errors.push(issue('$.arms', 'SESSION_REUSE', 'paired arms must use fresh, distinct sessions.'));
  }
  if (object(value.arms)
    && value.arms.off?.workspaceId === value.arms.approved_only?.workspaceId) {
    errors.push(issue('$.arms', 'WORKSPACE_REUSE', 'paired arms must use independent workspaces.'));
  }
  validateControls(value.controls, errors);
  const feedbackKeys = ['helpful', 'neutral', 'harmful', 'unobserved'];
  if (!object(value.feedbackCounts)
    || Object.keys(value.feedbackCounts).sort().join(',') !== [...feedbackKeys].sort().join(',')
    || !feedbackKeys.every(key => Number.isInteger(value.feedbackCounts[key]) && value.feedbackCounts[key] >= 0)) {
    errors.push(issue('$.feedbackCounts', 'COUNTS', 'feedback counts must be non-negative integers.'));
  }
  const utilizationFields = new Set(['availability', 'selectedCount', 'observedCount', 'rate', 'reason']);
  if (!object(value.utilization)
    || Object.keys(value.utilization).some(field => !utilizationFields.has(field))
    || !['reported', 'unavailable'].includes(value.utilization.availability)
    || !Number.isInteger(value.utilization.selectedCount) || value.utilization.selectedCount < 0
    || !Number.isInteger(value.utilization.observedCount) || value.utilization.observedCount < 0
    || (value.utilization.rate !== null
      && (typeof value.utilization.rate !== 'number' || value.utilization.rate < 0 || value.utilization.rate > 1))) {
    errors.push(issue('$.utilization', 'UTILIZATION', 'utilization availability is invalid.'));
  }
  if (object(value.utilization)) {
    if (value.utilization.availability === 'reported'
      && (typeof value.utilization.rate !== 'number' || Object.hasOwn(value.utilization, 'reason'))) {
      errors.push(issue('$.utilization', 'UTILIZATION', 'reported utilization requires a numeric rate and no reason.'));
    }
    if (value.utilization.availability === 'unavailable'
      && (value.utilization.rate !== null || !text(value.utilization.reason))) {
      errors.push(issue('$.utilization', 'UTILIZATION', 'unavailable utilization requires rate=null and a reason.'));
    }
    const selectedCount = value.arms?.approved_only?.selectedMemoryIds?.length;
    if (Number.isInteger(selectedCount) && value.utilization.selectedCount !== selectedCount) {
      errors.push(issue('$.utilization.selectedCount', 'UTILIZATION_MISMATCH', 'selectedCount must equal approved_only selectedMemoryIds length.'));
    }
    if (Number.isInteger(value.utilization.observedCount)
      && Number.isInteger(value.utilization.selectedCount)
      && value.utilization.observedCount > value.utilization.selectedCount) {
      errors.push(issue('$.utilization.observedCount', 'UTILIZATION_MISMATCH', 'observedCount cannot exceed selectedCount.'));
    }
    if (value.utilization.availability === 'reported'
      && value.utilization.selectedCount > 0
      && value.utilization.rate !== Number((value.utilization.observedCount / value.utilization.selectedCount).toFixed(6))) {
      errors.push(issue('$.utilization.rate', 'UTILIZATION_MISMATCH', 'rate must equal observedCount / selectedCount.'));
    }
    if (value.utilization.availability === 'unavailable'
      && (value.utilization.selectedCount !== 0 || value.utilization.observedCount !== 0)) {
      errors.push(issue('$.utilization', 'UTILIZATION_MISMATCH', 'unavailable utilization requires zero selected and observed memories.'));
    }
  }
  if (!object(value.deltas)
    || Object.keys(value.deltas).sort().join(',') !== 'cost,quality,time') {
    errors.push(issue('$.deltas', 'OBJECT', 'deltas must contain exactly quality, time, and cost.'));
  }
  else for (const field of ['quality', 'time', 'cost']) validateDelta(value.deltas[field], `$.deltas.${field}`, errors);
  if (value.comparisonStatus === 'ineligible' && object(value.deltas)) {
    for (const field of ['quality', 'time', 'cost']) {
      if (value.deltas[field]?.availability !== 'unavailable') {
        errors.push(issue(`$.deltas.${field}.availability`, 'INELIGIBLE_DELTA', 'ineligible comparisons cannot publish deltas.'));
      }
    }
  }
  if (value.comparisonStatus === 'eligible'
    && object(value.arms)
    && (value.arms.off?.resultStatus !== 'success' || value.arms.approved_only?.resultStatus !== 'success')) {
    errors.push(issue('$.comparisonStatus', 'ELIGIBILITY_MISMATCH', 'eligible comparison requires two successful arms.'));
  }
  if (value.comparisonStatus === 'ineligible'
    && object(value.arms)
    && value.arms.off?.resultStatus === 'success'
    && value.arms.approved_only?.resultStatus === 'success') {
    errors.push(issue('$.comparisonStatus', 'ELIGIBILITY_MISMATCH', 'ineligible comparison requires at least one failed arm.'));
  }
  if (!stringList(value.evidenceRefs)
    || value.evidenceRefs.length < 2
    || value.evidenceRefs.some(ref => !idMatches(EVIDENCE_REF, ref))) {
    errors.push(issue('$.evidenceRefs', 'EVIDENCE_REQUIRED', 'paired report requires independent evidence from both arms.'));
  }
  if (!isoDate(value.generatedAt)) errors.push(issue('$.generatedAt', 'DATE_TIME', 'generatedAt must be an ISO date-time.'));
  return finish(value, errors);
}

function validateDelta(value, path, errors) {
  if (!object(value) || !['reported', 'unavailable'].includes(value.availability)) {
    errors.push(issue(path, 'DELTA', 'delta must have reported or unavailable availability.'));
    return;
  }
  if (!text(value.unit)) errors.push(issue(`${path}.unit`, 'STRING', 'unit must be non-empty.'));
  if (value.availability === 'reported') {
    if (Object.keys(value).sort().join(',') !== 'availability,direction,unit,value') {
      errors.push(issue(path, 'UNEXPECTED_FIELD', 'reported delta fields are invalid.'));
    }
    if (typeof value.value !== 'number' || !Number.isFinite(value.value)) errors.push(issue(`${path}.value`, 'NUMBER', 'reported delta requires a number.'));
    if (value.direction !== 'approved_only_minus_off') errors.push(issue(`${path}.direction`, 'CONST', 'delta direction is invalid.'));
  } else {
    if (Object.keys(value).sort().join(',') !== 'availability,reason,unit,value') {
      errors.push(issue(path, 'UNEXPECTED_FIELD', 'unavailable delta fields are invalid.'));
    }
    if (value.value !== null) errors.push(issue(`${path}.value`, 'NULL', 'unavailable delta value must be null.'));
    if (!text(value.reason)) errors.push(issue(`${path}.reason`, 'STRING', 'unavailable delta requires a reason.'));
  }
}

export const MEMORY_ARMS = Object.freeze([...ARMS]);
export const MEMORY_OUTCOMES = Object.freeze([...OUTCOMES]);
