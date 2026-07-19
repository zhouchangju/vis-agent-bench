import { basename } from 'node:path';

/**
 * Fixture source exclusion rules.
 *
 * These define what a Fixture Builder is *never* allowed to copy out of an
 * answer-bearing source repository, regardless of what a Case author writes.
 * They exist because the answer, the answers' Git history, dependency caches
 * and editor indices are exactly the materials that defeat an agent benchmark.
 *
 * Categories (mirrors docs/architecture/ISOLATION_AND_ANTI_CHEATING.md):
 *
 *   - git        : `.git`, hooks, submodules, worktree metadata
 *   - deps       : installed dependencies and lock-derived caches
 *   - caches     : tool/build/test caches
 *   - answer     : answer implementation, tests, docs, indices
 *   - docs       : non-model-visible documentation
 *   - tests      : answer-bearing test fixtures (Case can mark which survive)
 *   - editor     : IDE / OS metadata that may carry absolute paths
 */

export const DEFAULT_EXCLUSION_GROUPS = {
  git: [
    '.git',
    '.hg',
    '.svn',
    '.gitmodules',
    '.gitattributes',
    '.gitignore', // a copied .gitignore would leak source-layout hints
  ],
  deps: [
    'node_modules',
    'bower_components',
    'vendor',
    '.pnp',
    '.yarn',
    '.turbo',
    '.parcel-cache',
    'jspm_packages',
    '.pnpm-store',
  ],
  caches: [
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.nuxt',
    '.cache',
    '.eslintcache',
    '.turbo-cache',
    '.babel-cache',
    'tsconfig.tsbuildinfo',
    '*.tsbuildinfo',
    '.DS_Store',
    'Thumbs.db',
  ],
  answer: [
    // Answer-implementation repositories frequently keep search indices that
    // embed the very code we are trying to hide. Drop them by default; a Case
    // can opt a specific tool index back in if it is provably answer-free.
    '.algolia',
    'search-index',
    '.fusebox',
    'idx',
    'meili-index',
  ],
  docs: [
    'CHANGELOG.md',
    'CHANGELOG',
    'CODE_OF_CONDUCT.md',
    'SECURITY.md',
  ],
  tests: [], // tests opt-in: by default *all* test files are dropped, a Case lists survivors
  editor: [
    '.idea',
    '.vscode',
    '.fleet',
    '.cursor',
    '.zed',
  ],
};

/**
 * Resolve a Case-declared exclusion fragment against the defaults.
 *
 * Case YAML may declare any of:
 *   exclusion:
 *     extend_defaults: true            # default true
 *     groups: { deps: [...], docs: [] } # add to or override specific groups
 *     glob: [ "double-star-slash.secret" ] # extra literal/glob patterns
 *     paths: [ "src/internal/**" ]     # explicit path globs to drop
 *
 * @param {Object} [declared]
 * @returns {{ groups: Record<string, string[]>, globs: string[], extend_defaults: boolean }}
 */
export function resolveExclusionConfig(declared = {}) {
  const extendDefaults = declared.extend_defaults !== false;
  const groups = extendDefaults
    ? structuredClone(DEFAULT_EXCLUSION_GROUPS)
    : Object.fromEntries(Object.keys(DEFAULT_EXCLUSION_GROUPS).map(key => [key, []]));

  if (declared.groups && typeof declared.groups === 'object') {
    for (const [key, value] of Object.entries(declared.groups)) {
      if (!Array.isArray(value)) continue;
      if (extendDefaults) {
        const set = new Set([...(groups[key] || []), ...value]);
        groups[key] = [...set];
      } else {
        groups[key] = [...value];
      }
    }
  }

  const extraGlobs = [];
  for (const field of ['glob', 'globs', 'patterns']) {
    const value = declared[field];
    if (Array.isArray(value)) extraGlobs.push(...value);
    else if (typeof value === 'string') extraGlobs.push(value);
  }
  for (const field of ['paths', 'path']) {
    const value = declared[field];
    if (Array.isArray(value)) extraGlobs.push(...value);
    else if (typeof value === 'string') extraGlobs.push(value);
  }

  return { groups, globs: extraGlobs, extend_defaults: extendDefaults };
}

/**
 * Compile exclusion patterns into a single predicate used by the recursive
 * copy filter. Returns a function `(entryPath, isDirectory) => boolean` where
 * a truthy return means "exclude".
 *
 * @param {{ groups: Record<string, string[]>, globs: string[] }} config
 */
export function compileExclusionFilter(config) {
  const nameSet = new Set();
  const nameGlobs = [];
  const pathGlobs = [];

  for (const patterns of Object.values(config.groups)) {
    for (const pattern of patterns) {
      if (!pattern) continue;
      if (isGlob(pattern)) {
        if (pattern.includes('/')) pathGlobs.push(compileGlob(pattern));
        else nameGlobs.push(compileGlob(pattern));
      } else {
        nameSet.add(pattern);
      }
    }
  }
  for (const pattern of config.globs) {
    if (!pattern) continue;
    pathGlobs.push(compileGlob(pattern));
  }

  return function shouldExclude(relativePath, isDirectory) {
    const base = basename(relativePath);
    if (nameSet.has(base)) return true;
    // A name-rule like `dist` must also fire when it appears as an ancestor
    // directory (e.g. `dist/index.js`), otherwise we would still copy the
    // answer-bearing build output we are trying to drop.
    const segments = relativePath.split('/');
    for (const segment of segments) {
      if (nameSet.has(segment)) return true;
    }
    for (const test of nameGlobs) {
      if (test(base)) return true;
      if (segments.some(segment => test(segment))) return true;
    }
    for (const test of pathGlobs) {
      if (test(relativePath)) return true;
      // Also allow path globs written against a leaf name to match a directory
      // we are about to descend into.
      if (isDirectory && test(base)) return true;
    }
    return false;
  };
}

function isGlob(pattern) {
  return /[*?[\]{}]/.test(pattern);
}

/**
 * Minimal, deterministic glob → RegExp compiler.
 *
 * Supports `*` (single-segment), `**` (any segments), `?` (single char),
 * `[abc]` / `[!abc]` character classes, and `{a,b}` alternatives. Anything
 * else is escaped. Designed to behave identically across Node versions and
 * across platforms (we always match against forward-slash relative paths).
 */
export function compileGlob(pattern) {
  let i = 0;
  const out = ['^'];
  let segment = '';

  const flushSegment = () => {
    if (segment === '') return;
    out.push(segment.replace(/[.+^$()|\\]/g, '\\$&'));
    segment = '';
  };

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      flushSegment();
      if (pattern[i + 1] === '*') {
        i += 2;
        // `**/` → any number of segments including zero
        if (pattern[i] === '/') {
          i += 1;
          out.push('(?:.*/)?');
        } else {
          out.push('.*');
        }
      } else {
        i += 1;
        out.push('[^/]*');
      }
      continue;
    }

    if (char === '?') {
      flushSegment();
      out.push('[^/]');
      i += 1;
      continue;
    }

    if (char === '[') {
      flushSegment();
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        segment += '\\[';
        i += 1;
        continue;
      }
      let body = pattern.slice(i + 1, end);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out.push(`[${body}]`);
      i = end + 1;
      continue;
    }

    if (char === '{') {
      flushSegment();
      const end = pattern.indexOf('}', i + 1);
      if (end === -1) {
        segment += '\\{';
        i += 1;
        continue;
      }
      const options = pattern.slice(i + 1, end).split(',').map(option => option.replace(/[.+^$()|\\]/g, '\\$&'));
      out.push(`(?:${options.join('|')})`);
      i = end + 1;
      continue;
    }

    if (char === '/') {
      flushSegment();
      out.push('/');
      i += 1;
      continue;
    }

    segment += char;
    i += 1;
  }
  flushSegment();
  out.push('$');
  const regex = new RegExp(out.join(''));
  return value => regex.test(value);
}
