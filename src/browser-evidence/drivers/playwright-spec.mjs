const STEP_KINDS = new Set([
  'goto',
  'wait',
  'click',
  'hover',
  'keyboard',
  'resize',
  'screenshot',
  'assert-visible',
  'assert-text',
  'collect-state',
]);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function diagnostic(path, code, message) {
  return { path, code, message };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateLocalUrl(value, path, errors) {
  if (!nonEmpty(value)) {
    errors.push(diagnostic(path, 'REQUIRED', 'goto.url must be a non-empty local URL.'));
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(diagnostic(path, 'URL', 'goto.url must be a valid URL.'));
    return;
  }
  if (parsed.protocol === 'file:') return;
  if (!['http:', 'https:'].includes(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    errors.push(diagnostic(path, 'LOCAL_URL_ONLY', 'Only file: and loopback http(s) URLs are allowed.'));
  }
}

function validateTimeout(value, path, errors) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 120_000)) {
    errors.push(diagnostic(path, 'NUMBER_RANGE', 'timeout_ms must be an integer from 0 to 120000.'));
  }
}

function validateStep(step, index, errors) {
  const path = `$.steps[${index}]`;
  if (!isObject(step)) {
    errors.push(diagnostic(path, 'OBJECT', 'Each step must be an object.'));
    return;
  }
  if (!STEP_KINDS.has(step.kind)) {
    errors.push(diagnostic(`${path}.kind`, 'ENUM', `kind must be one of: ${[...STEP_KINDS].join(', ')}.`));
    return;
  }
  const common = new Set(['kind', 'label', 'timeout_ms']);
  const fields = {
    goto: ['url', 'wait_until'],
    wait: ['selector', 'state', 'duration_ms'],
    click: ['selector'],
    hover: ['selector'],
    keyboard: ['selector', 'key'],
    resize: ['width', 'height'],
    screenshot: ['full_page'],
    'assert-visible': ['selector'],
    'assert-text': ['selector', 'text', 'match'],
    'collect-state': ['selectors'],
  };
  const allowed = new Set([...common, ...fields[step.kind]]);
  for (const key of Object.keys(step)) {
    if (!allowed.has(key)) errors.push(diagnostic(`${path}.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed for this step.'));
  }
  if (step.label != null && (!nonEmpty(step.label) || !LABEL.test(step.label))) {
    errors.push(diagnostic(`${path}.label`, 'LABEL', 'label must be 1-64 URL-safe characters.'));
  }
  validateTimeout(step.timeout_ms, `${path}.timeout_ms`, errors);

  if (step.kind === 'goto') {
    validateLocalUrl(step.url, `${path}.url`, errors);
    if (step.wait_until != null && !['load', 'domcontentloaded', 'networkidle', 'commit'].includes(step.wait_until)) {
      errors.push(diagnostic(`${path}.wait_until`, 'ENUM', 'wait_until is not supported.'));
    }
  }
  if (['click', 'hover', 'assert-visible', 'assert-text'].includes(step.kind) && !nonEmpty(step.selector)) {
    errors.push(diagnostic(`${path}.selector`, 'REQUIRED', `${step.kind} requires selector.`));
  }
  if (step.kind === 'keyboard') {
    if (!nonEmpty(step.key)) errors.push(diagnostic(`${path}.key`, 'REQUIRED', 'keyboard requires key.'));
    if (step.selector != null && !nonEmpty(step.selector)) errors.push(diagnostic(`${path}.selector`, 'STRING', 'selector must be non-empty.'));
  }
  if (step.kind === 'resize' && (!positiveInteger(step.width) || !positiveInteger(step.height))) {
    errors.push(diagnostic(path, 'VIEWPORT', 'resize requires positive integer width and height.'));
  }
  if (step.kind === 'wait') {
    const hasSelector = nonEmpty(step.selector);
    const hasDuration = Number.isInteger(step.duration_ms) && step.duration_ms >= 0 && step.duration_ms <= 10_000;
    if (hasSelector === hasDuration) {
      errors.push(diagnostic(path, 'WAIT_MODE', 'wait requires exactly one of selector or duration_ms (max 10000).'));
    }
    if (step.state != null && !['attached', 'detached', 'visible', 'hidden'].includes(step.state)) {
      errors.push(diagnostic(`${path}.state`, 'ENUM', 'wait.state is not supported.'));
    }
  }
  if (step.kind === 'assert-text') {
    if (typeof step.text !== 'string') errors.push(diagnostic(`${path}.text`, 'REQUIRED', 'assert-text requires text.'));
    if (step.match != null && !['contains', 'exact'].includes(step.match)) {
      errors.push(diagnostic(`${path}.match`, 'ENUM', 'match must be contains or exact.'));
    }
  }
  if (step.kind === 'collect-state') {
    if (!Array.isArray(step.selectors) || !step.selectors.length || step.selectors.some(selector => !nonEmpty(selector))) {
      errors.push(diagnostic(`${path}.selectors`, 'ARRAY', 'collect-state requires a non-empty array of CSS selectors.'));
    }
  }
}

export function validatePlaywrightSpec(input) {
  const errors = [];
  if (!isObject(input)) return { valid: false, errors: [diagnostic('$', 'OBJECT', 'Spec must be an object.')], spec: null };
  const allowed = new Set([
    'schema_version', 'capture_id', 'run_id', 'case_id', 'viewport', 'steps',
    'default_timeout_ms', 'capture_console_errors', 'capture_page_errors',
    'capture_network_failures', 'capture_dom_summary',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(diagnostic(`$.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed.'));
  }
  if (input.schema_version != null && input.schema_version !== 1) {
    errors.push(diagnostic('$.schema_version', 'CONST', 'schema_version must be 1.'));
  }
  for (const field of ['capture_id', 'run_id', 'case_id']) {
    if (!nonEmpty(input[field])) errors.push(diagnostic(`$.${field}`, 'REQUIRED', `${field} is required.`));
  }
  if (input.viewport != null && (!isObject(input.viewport)
    || !positiveInteger(input.viewport.width) || !positiveInteger(input.viewport.height))) {
    errors.push(diagnostic('$.viewport', 'VIEWPORT', 'viewport requires positive integer width and height.'));
  }
  validateTimeout(input.default_timeout_ms, '$.default_timeout_ms', errors);
  for (const field of [
    'capture_console_errors', 'capture_page_errors', 'capture_network_failures', 'capture_dom_summary',
  ]) {
    if (input[field] != null && typeof input[field] !== 'boolean') {
      errors.push(diagnostic(`$.${field}`, 'BOOLEAN', `${field} must be boolean.`));
    }
  }
  if (!Array.isArray(input.steps) || !input.steps.length) {
    errors.push(diagnostic('$.steps', 'ARRAY', 'steps must be a non-empty array.'));
  } else {
    input.steps.forEach((step, index) => validateStep(step, index, errors));
    if (input.steps[0]?.kind !== 'goto') {
      errors.push(diagnostic('$.steps[0].kind', 'FIRST_STEP', 'The first step must be goto.'));
    }
  }
  if (errors.length) return { valid: false, errors, spec: null };
  return {
    valid: true,
    errors: [],
    spec: {
      schema_version: 1,
      capture_id: input.capture_id,
      run_id: input.run_id,
      case_id: input.case_id,
      viewport: input.viewport ?? { width: 1280, height: 800 },
      steps: input.steps.map(step => ({ ...step })),
      default_timeout_ms: input.default_timeout_ms ?? 5_000,
      capture_console_errors: input.capture_console_errors ?? true,
      capture_page_errors: input.capture_page_errors ?? true,
      capture_network_failures: input.capture_network_failures ?? true,
      capture_dom_summary: input.capture_dom_summary ?? true,
    },
  };
}

export const PLAYWRIGHT_STEP_KINDS = [...STEP_KINDS];
