import { isAbsolute, isRelativePathToExistingFile, resolve } from './paths.mjs';

/**
 * Capture protocol for one evidence collection run.
 *
 * The capture spec is the model-visible, declarative contract that the
 * reviewer (or a CI step) hands to the browser evidence driver. It only
 * describes WHAT to capture and WHERE to look; the driver decides HOW.
 *
 * Allowed `wait.kind` values:
 *   - "load"            wait for the browser `load` event.
 *   - "domcontentloaded" wait for DOMContentLoaded.
 *   - "networkidle"     best-effort wait until network settles.
 *   - "selector"        wait for a CSS selector to appear in the DOM.
 *   - "function"        wait for a JS expression to evaluate truthy.
 *   - "none"            do not wait.
 *
 * Action `kind` values:
 *   - "click"           click the element matched by `selector`.
 *   - "focus"           focus the element matched by `selector`.
 *   - "scroll"          scroll to (x, y) on the page or within `selector`.
 *   - "type"            type `text` into `selector`.
 *   - "keypress"        press `key` (e.g. "Enter").
 *   - "select"          choose `value` on a <select> at `selector`.
 *   - "wait"            wait for `wait` (same shape as the top-level wait).
 *   - "screenshot"      capture a screenshot, tagged with `label`.
 *   - "domSnapshot"     record a DOM summary, tagged with `label`.
 *   - "assert"          evaluate `expression`; failure is a capture error.
 */

const WAIT_KINDS = new Set(['load', 'domcontentloaded', 'networkidle', 'selector', 'function', 'none']);
const ACTION_KINDS = new Set([
  'click', 'focus', 'scroll', 'type', 'keypress', 'select',
  'wait', 'screenshot', 'domSnapshot', 'assert',
  // Roadmap M3 extensions: WebGL semantic probe and performance sample.
  // Drivers that lack a real browser should no-op these and emit a skip
  // entry in their evidence; the assertions in webgl-inspector.mjs and
  // perf-collector.mjs degrade to skip status.
  'webglInspect', 'perfMeasure',
]);

function diagnostic(path, code, message) {
  return { path, code, message };
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInteger(value, { min = -Infinity, max = Infinity } = {}) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateViewport(value, path, errors) {
  if (value == null) return;
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'viewport must be an object.'));
    return;
  }
  const allowed = new Set(['width', 'height', 'device_scale_factor']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(diagnostic(`${path}.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed in viewport.'));
  }
  if (!isInteger(value.width, { min: 1 })) errors.push(diagnostic(`${path}.width`, 'NUMBER_RANGE', 'viewport.width must be a positive integer.'));
  if (!isInteger(value.height, { min: 1 })) errors.push(diagnostic(`${path}.height`, 'NUMBER_RANGE', 'viewport.height must be a positive integer.'));
  if (value.device_scale_factor != null && (typeof value.device_scale_factor !== 'number' || value.device_scale_factor <= 0)) {
    errors.push(diagnostic(`${path}.device_scale_factor`, 'NUMBER_RANGE', 'device_scale_factor must be a positive number.'));
  }
}

function validateWait(value, path, errors) {
  if (value == null) return;
  if (!isObject(value)) {
    errors.push(diagnostic(path, 'OBJECT', 'wait must be an object.'));
    return;
  }
  const allowed = new Set(['kind', 'selector', 'expression', 'timeout_ms']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(diagnostic(`${path}.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed in wait.'));
  }
  if (!WAIT_KINDS.has(value.kind)) {
    errors.push(diagnostic(`${path}.kind`, 'ENUM', `wait.kind must be one of: ${[...WAIT_KINDS].join(', ')}.`));
    return;
  }
  if (value.kind === 'selector' && !isNonEmptyString(value.selector)) {
    errors.push(diagnostic(`${path}.selector`, 'REQUIRED', 'selector wait requires a CSS selector.'));
  }
  if (value.kind === 'function' && !isNonEmptyString(value.expression)) {
    errors.push(diagnostic(`${path}.expression`, 'REQUIRED', 'function wait requires a JS expression.'));
  }
  if (value.timeout_ms != null && !isInteger(value.timeout_ms, { min: 0 })) {
    errors.push(diagnostic(`${path}.timeout_ms`, 'NUMBER_RANGE', 'wait.timeout_ms must be a non-negative integer.'));
  }
}

function validateAction(action, index, root, errors) {
  const path = `actions[${index}]`;
  if (!isObject(action)) {
    errors.push(diagnostic(path, 'OBJECT', 'Action must be an object.'));
    return;
  }
  const allowed = new Set(['kind', 'label', 'selector', 'text', 'key', 'value', 'x', 'y', 'expression', 'wait', 'timeout_ms', 'note', 'sample_ms', 'threshold', 'baseline']);
  for (const key of Object.keys(action)) {
    if (!allowed.has(key)) errors.push(diagnostic(`${path}.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed on an action.'));
  }
  if (!ACTION_KINDS.has(action.kind)) {
    errors.push(diagnostic(`${path}.kind`, 'ENUM', `action.kind must be one of: ${[...ACTION_KINDS].join(', ')}.`));
    return;
  }
  if (action.label != null && !isNonEmptyString(action.label)) {
    errors.push(diagnostic(`${path}.label`, 'STRING', 'action.label must be a non-empty string when present.'));
  }
  if (action.note != null && !isNonEmptyString(action.note)) {
    errors.push(diagnostic(`${path}.note`, 'STRING', 'action.note must be a non-empty string when present.'));
  }
  if (action.timeout_ms != null && !isInteger(action.timeout_ms, { min: 0 })) {
    errors.push(diagnostic(`${path}.timeout_ms`, 'NUMBER_RANGE', 'action.timeout_ms must be a non-negative integer.'));
  }
  if (action.sample_ms != null && !isInteger(action.sample_ms, { min: 1 })) {
    errors.push(diagnostic(`${path}.sample_ms`, 'NUMBER_RANGE', 'action.sample_ms must be a positive integer when present.'));
  }
  if (action.threshold != null && (typeof action.threshold !== 'number' || action.threshold < 0 || action.threshold > 1)) {
    errors.push(diagnostic(`${path}.threshold`, 'NUMBER_RANGE', 'action.threshold must be a number in [0,1] when present.'));
  }
  if (action.baseline != null && !isNonEmptyString(action.baseline)) {
    errors.push(diagnostic(`${path}.baseline`, 'STRING', 'action.baseline must be a non-empty string when present.'));
  }
  switch (action.kind) {
    case 'click':
    case 'focus':
    case 'type':
    case 'select':
      if (!isNonEmptyString(action.selector)) {
        errors.push(diagnostic(`${path}.selector`, 'REQUIRED', `${action.kind} action requires a selector.`));
      }
      break;
    case 'scroll':
      // Either selector (scroll within element) or x/y (scroll document).
      break;
    case 'keypress':
      if (!isNonEmptyString(action.key)) errors.push(diagnostic(`${path}.key`, 'REQUIRED', 'keypress action requires a key.'));
      break;
    case 'type':
      if (typeof action.text !== 'string') errors.push(diagnostic(`${path}.text`, 'REQUIRED', 'type action requires text.'));
      break;
    case 'select':
      if (typeof action.value !== 'string') errors.push(diagnostic(`${path}.value`, 'REQUIRED', 'select action requires a value.'));
      break;
    case 'assert':
      if (!isNonEmptyString(action.expression)) errors.push(diagnostic(`${path}.expression`, 'REQUIRED', 'assert action requires an expression.'));
      break;
    case 'wait':
      validateWait(action.wait, `${path}.wait`, errors);
      break;
    case 'webglInspect':
    case 'perfMeasure':
      // Declarative probe actions. No required fields; the driver collects
      // a facts object tagged with `label`.
      break;
    default:
      break;
  }
}

/**
 * Validate a capture spec object.
 *
 * Returns `{ valid, errors, spec }`. The returned `spec` is normalized:
 * optional fields are filled with defaults, unknown fields are stripped,
 * and absolute fixture paths are resolved relative to `root`.
 */
export function validateCaptureSpec(input, { root = process.cwd() } = {}) {
  const errors = [];
  if (!isObject(input)) {
    return {
      valid: false,
      errors: [diagnostic('$', 'OBJECT', 'Capture spec must be an object.')],
      spec: null,
    };
  }
  const allowed = new Set([
    'capture_id', 'run_id', 'case_id', 'url', 'fixture_dir', 'fixture_index',
    'viewport', 'user_agent', 'wait', 'actions', 'screenshot_format',
    'capture_dom_summary', 'capture_console_errors', 'capture_page_errors',
    'capture_network_failures', 'default_action_timeout_ms', 'default_wait_timeout_ms',
    'blind_review_excludes',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(diagnostic(`$.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed in capture spec.'));
  }
  if (!isNonEmptyString(input.capture_id)) {
    errors.push(diagnostic('$.capture_id', 'REQUIRED', 'capture_id is required.'));
  }
  if (!isNonEmptyString(input.run_id)) {
    errors.push(diagnostic('$.run_id', 'REQUIRED', 'run_id is required.'));
  }
  if (!isNonEmptyString(input.case_id)) {
    errors.push(diagnostic('$.case_id', 'REQUIRED', 'case_id is required.'));
  }
  if (input.url != null) {
    if (!isNonEmptyString(input.url) || !/^(https?|file):/i.test(input.url)) {
      errors.push(diagnostic('$.url', 'URL', 'url must be an http(s): or file: URL.'));
    }
  } else if (!isNonEmptyString(input.fixture_dir) && !isNonEmptyString(input.fixture_index)) {
    errors.push(diagnostic('$.url', 'REQUIRED', 'Either url or fixture_dir/fixture_index must be set.'));
  }
  if (input.fixture_dir != null && isAbsolute(input.fixture_dir)) {
    errors.push(diagnostic('$.fixture_dir', 'RELATIVE_PATH', 'fixture_dir must be relative to root.'));
  }
  if (input.fixture_index != null && isAbsolute(input.fixture_index)) {
    errors.push(diagnostic('$.fixture_index', 'RELATIVE_PATH', 'fixture_index must be relative to fixture_dir.'));
  }
  if (input.screenshot_format != null && !['png', 'jpeg'].includes(input.screenshot_format)) {
    errors.push(diagnostic('$.screenshot_format', 'ENUM', 'screenshot_format must be png or jpeg.'));
  }
  for (const field of [
    'capture_dom_summary', 'capture_console_errors', 'capture_page_errors',
    'capture_network_failures', 'blind_review_excludes',
  ]) {
    if (input[field] != null && typeof input[field] !== 'boolean') {
      errors.push(diagnostic(`$.${field}`, 'BOOLEAN', `${field} must be boolean when present.`));
    }
  }
  if (input.default_action_timeout_ms != null && !isInteger(input.default_action_timeout_ms, { min: 0 })) {
    errors.push(diagnostic('$.default_action_timeout_ms', 'NUMBER_RANGE', 'must be a non-negative integer.'));
  }
  if (input.default_wait_timeout_ms != null && !isInteger(input.default_wait_timeout_ms, { min: 0 })) {
    errors.push(diagnostic('$.default_wait_timeout_ms', 'NUMBER_RANGE', 'must be a non-negative integer.'));
  }
  validateViewport(input.viewport, '$.viewport', errors);
  validateWait(input.wait, '$.wait', errors);
  if (input.actions != null) {
    if (!Array.isArray(input.actions)) {
      errors.push(diagnostic('$.actions', 'ARRAY', 'actions must be an array.'));
    } else {
      input.actions.forEach((action, index) => validateAction(action, index, root, errors));
    }
  }
  if (errors.length) {
    return { valid: false, errors, spec: null };
  }
  const spec = {
    capture_id: input.capture_id,
    run_id: input.run_id,
    case_id: input.case_id,
    url: input.url ?? null,
    fixture_dir: input.fixture_dir ?? null,
    fixture_index: input.fixture_index ?? (input.fixture_dir ? 'index.html' : null),
    viewport: input.viewport ?? { width: 1280, height: 800 },
    user_agent: input.user_agent ?? null,
    wait: input.wait ?? { kind: 'load' },
    actions: Array.isArray(input.actions) ? input.actions : [],
    screenshot_format: input.screenshot_format ?? 'png',
    capture_dom_summary: input.capture_dom_summary ?? true,
    capture_console_errors: input.capture_console_errors ?? true,
    capture_page_errors: input.capture_page_errors ?? true,
    capture_network_failures: input.capture_network_failures ?? true,
    default_action_timeout_ms: input.default_action_timeout_ms ?? 5_000,
    default_wait_timeout_ms: input.default_wait_timeout_ms ?? 15_000,
    blind_review_excludes: input.blind_review_excludes ?? true,
    _root: resolve(root),
    _fixture_root: input.fixture_dir ? resolve(root, input.fixture_dir) : null,
  };
  // Existence of fixture_dir is intentionally NOT enforced here: validation is
  // for shape and value ranges. A missing fixture surfaces at capture time as
  // a structured LOAD_FAILED error, which is the contract reviewers rely on.
  return { valid: true, errors: [], spec };
}

export const CAPTURE_SPEC = {
  WAIT_KINDS: [...WAIT_KINDS],
  ACTION_KINDS: [...ACTION_KINDS],
};
