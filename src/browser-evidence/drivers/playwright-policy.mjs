import { realpathSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function diagnostic(path, code, message) {
  return { path, code, message };
}

function isLoopbackHostname(hostname) {
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (bare.toLowerCase() === 'localhost') return true;
  const ipVersion = isIP(bare);
  if (ipVersion === 4) return bare.startsWith('127.');
  return ipVersion === 6 && bare === '::1';
}

function containsPath(root, target) {
  const child = relative(root, target);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
}

export function normalizePlaywrightPolicy(input = {}) {
  const errors = [];
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: [diagnostic('$policy', 'OBJECT', 'Browser policy must be an object supplied by the control plane.')],
      policy: null,
    };
  }
  const allowedFields = new Set(['allowed_origins', 'allowed_file_roots']);
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      errors.push(diagnostic(`$policy.${key}`, 'UNEXPECTED_FIELD', 'Field is not allowed in browser policy.'));
    }
  }

  const origins = input.allowed_origins ?? [];
  if (!Array.isArray(origins) || origins.some(value => typeof value !== 'string')) {
    errors.push(diagnostic('$policy.allowed_origins', 'ARRAY', 'allowed_origins must be an array of exact origin strings.'));
  }
  const normalizedOrigins = new Set();
  if (Array.isArray(origins)) {
    origins.forEach((value, index) => {
      try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)
          || !isLoopbackHostname(parsed.hostname)
          || value !== parsed.origin) {
          throw new Error('origin must be an exact loopback http(s) origin with scheme, host, and port');
        }
        normalizedOrigins.add(parsed.origin);
      } catch (error) {
        errors.push(diagnostic(
          `$policy.allowed_origins[${index}]`,
          'ORIGIN',
          `Invalid allowed origin: ${error.message}.`,
        ));
      }
    });
  }

  const roots = input.allowed_file_roots ?? [];
  if (!Array.isArray(roots) || roots.some(value => typeof value !== 'string')) {
    errors.push(diagnostic('$policy.allowed_file_roots', 'ARRAY', 'allowed_file_roots must be an array of existing directory paths.'));
  }
  const normalizedRoots = [];
  if (Array.isArray(roots)) {
    roots.forEach((value, index) => {
      try {
        const real = realpathSync(resolve(value));
        if (!statSync(real).isDirectory()) throw new Error('path is not a directory');
        normalizedRoots.push(real);
      } catch (error) {
        errors.push(diagnostic(
          `$policy.allowed_file_roots[${index}]`,
          'FILE_ROOT',
          `Invalid allowed fixture root: ${error.message}.`,
        ));
      }
    });
  }

  return errors.length
    ? { valid: false, errors, policy: null }
    : {
      valid: true,
      errors: [],
      policy: {
        allowedOrigins: normalizedOrigins,
        allowedFileRoots: [...new Set(normalizedRoots)],
      },
    };
}

export function checkPolicyUrl(value, policy) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { allowed: false, reason: 'URL is invalid.' };
  }
  if (parsed.protocol === 'file:') {
    if (parsed.hostname) return { allowed: false, reason: 'Remote file: authorities are forbidden.' };
    let real;
    try {
      real = realpathSync(fileURLToPath(parsed));
    } catch (error) {
      return { allowed: false, reason: `File target cannot be resolved: ${error.message}.` };
    }
    const root = policy.allowedFileRoots.find(candidate => containsPath(candidate, real));
    return root
      ? { allowed: true, kind: 'file', target: real, matched: root }
      : { allowed: false, reason: 'Resolved file target is outside every allowed fixture root.', target: real };
  }
  if (['http:', 'https:'].includes(parsed.protocol)) {
    if (!isLoopbackHostname(parsed.hostname)) {
      return { allowed: false, reason: 'Only loopback HTTP(S) origins may be allowlisted.' };
    }
    return policy.allowedOrigins.has(parsed.origin)
      ? { allowed: true, kind: 'origin', target: parsed.href, matched: parsed.origin }
      : { allowed: false, reason: `Origin ${parsed.origin} is not explicitly allowed.` };
  }
  return { allowed: false, reason: `Protocol ${parsed.protocol} is not allowed.` };
}

export function validateSpecUrlsAgainstPolicy(spec, policy) {
  const errors = [];
  spec.steps.forEach((step, index) => {
    if (step.kind !== 'goto') return;
    const decision = checkPolicyUrl(step.url, policy);
    if (!decision.allowed) {
      errors.push(diagnostic(`$.steps[${index}].url`, 'POLICY_DENIED', decision.reason));
    }
  });
  return errors;
}
