import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path';

export const resolve = resolvePath;

export function isRelative(value) {
  return typeof value === 'string' && value.length > 0 && !isAbsolute(value);
}

/**
 * True when `relPath` resolves to an existing path inside `root`.
 * Used to keep fixture references confined to the declared fixture directory.
 */
export function isRelativePathToExistingFile(root, relPath) {
  if (!isRelative(relPath)) return false;
  const absolute = resolvePath(root, relPath);
  if (!absolute.startsWith(resolvePath(root))) return false;
  return existsSync(absolute);
}

/**
 * Resolve a path that must stay inside `root`. Rejects absolute paths,
 * path traversal outside the root and symlinks that escape the root.
 */
export function safeResolveInside(root, relPath) {
  if (!isRelative(relPath)) {
    throw new Error(`Path must be relative: ${relPath}`);
  }
  const rootAbs = resolvePath(root);
  const candidate = resolvePath(rootAbs, relPath);
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + '/')) {
    throw new Error(`Path escapes root: ${relPath}`);
  }
  // Resolve symlinks and re-check containment to prevent escape via links.
  if (existsSync(candidate)) {
    const real = realpathSync(candidate);
    if (real !== rootAbs && !real.startsWith(rootAbs + '/')) {
      throw new Error(`Symlink escapes root: ${relPath}`);
    }
  }
  return candidate;
}

export function ensureInside(root, absPath) {
  const rootAbs = resolvePath(root);
  const target = resolvePath(absPath);
  if (target !== rootAbs && !target.startsWith(rootAbs + '/')) {
    throw new Error(`Path escapes root: ${relative(rootAbs, target) || target}`);
  }
  return target;
}

export { join, relative, isAbsolute };
