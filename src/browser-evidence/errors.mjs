/**
 * Structured error contract for browser evidence capture.
 *
 * Every failure mode required by VAB-T06 maps to a stable `code` so the
 * evaluator and the review UI can branch on it without parsing messages.
 *
 * Codes:
 *   LOAD_FAILED          navigation/load could not complete.
 *   SELECTOR_MISSING     a selector used in wait/action did not resolve.
 *   ACTION_TIMEOUT       an action exceeded its timeout.
 *   ASSERT_FAILED        an `assert` action evaluated falsy.
 *   NETWORK_FAILURE      one or more network requests failed (when captured).
 *   PAGE_ERROR           an uncaught page error was observed.
 *   CAPTURE_INCOMPLETE   capture ended before all required evidence was written.
 *   DRIVER_UNAVAILABLE   no driver could be selected for the requested spec.
 *   SPEC_INVALID         the capture spec failed validation.
 *   IO_ERROR             a filesystem operation failed.
 */

const CODES = new Set([
  'LOAD_FAILED',
  'SELECTOR_MISSING',
  'ACTION_TIMEOUT',
  'ASSERT_FAILED',
  'NETWORK_FAILURE',
  'PAGE_ERROR',
  'CAPTURE_INCOMPLETE',
  'DRIVER_UNAVAILABLE',
  'SPEC_INVALID',
  'IO_ERROR',
]);

export function structuredError(code, message, { cause, ...details } = {}) {
  if (!CODES.has(code)) throw new Error(`Unknown browser-evidence error code: ${code}`);
  const payload = {
    code,
    message: typeof message === 'string' && message.length ? message : `${code} (no detail)`,
  };
  if (cause instanceof Error) payload.cause = cause.message;
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined && value !== null) payload[key] = value;
  }
  return payload;
}

export function isStructuredError(value) {
  return value != null && typeof value === 'object'
    && typeof value.code === 'string'
    && CODES.has(value.code)
    && typeof value.message === 'string';
}

/**
 * Turn a raw Error into a structured error using a best-guess code.
 * Capture drivers should call this only as a last resort when a more
 * specific code is unavailable.
 */
export function coerceError(error, fallbackCode = 'CAPTURE_INCOMPLETE', extra = {}) {
  if (isStructuredError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return structuredError(fallbackCode, message, extra);
}

export const ERROR_CODES = [...CODES];
