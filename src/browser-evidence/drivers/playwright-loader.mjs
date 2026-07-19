import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function packageCandidates() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE_PATH) {
    candidates.push({ request: resolve(process.env.PLAYWRIGHT_MODULE_PATH), source: 'configured-module-path' });
  }
  candidates.push({ request: 'playwright', source: 'project-module' });

  const npmNpxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npmNpxRoot)) {
    for (const entry of readdirSync(npmNpxRoot).sort().reverse()) {
      candidates.push({
        request: join(npmNpxRoot, entry, 'node_modules', 'playwright'),
        source: 'npm-npx-cache',
      });
    }
  }

  const globalRoot = resolve(dirname(process.execPath), '..', 'lib', 'node_modules');
  candidates.push({ request: join(globalRoot, 'playwright'), source: 'global-module' });
  return candidates;
}

export function loadPlaywright() {
  const attempts = [];
  for (const candidate of packageCandidates()) {
    try {
      const playwright = require(candidate.request);
      if (playwright?.chromium) {
        return { playwright, source: candidate.source, attempts };
      }
      attempts.push({ source: candidate.source, reason: 'module did not export chromium' });
    } catch (error) {
      attempts.push({ source: candidate.source, reason: error.code ?? error.name ?? 'load failed' });
    }
  }
  const error = new Error('No usable Playwright package was found in the project, configured path, npm cache, or global modules.');
  error.attempts = attempts;
  throw error;
}

function cacheRoots() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    return [resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)];
  }
  return process.platform === 'darwin'
    ? [join(homedir(), 'Library', 'Caches', 'ms-playwright')]
    : [join(homedir(), '.cache', 'ms-playwright')];
}

function executableNames() {
  if (process.platform === 'darwin') {
    return new Set(['Google Chrome for Testing', 'chrome-headless-shell']);
  }
  if (process.platform === 'win32') {
    return new Set(['chrome.exe', 'headless_shell.exe']);
  }
  return new Set(['chrome', 'headless_shell']);
}

function walkForExecutables(root, depth = 0) {
  if (depth > 7 || !existsSync(root)) return [];
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isFile() && executableNames().has(entry.name)) {
      matches.push(absolute);
    } else if (entry.isDirectory()) {
      matches.push(...walkForExecutables(absolute, depth + 1));
    }
  }
  return matches;
}

export function resolveChromiumExecutable(chromium) {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured) {
    const absolute = resolve(configured);
    if (!existsSync(absolute)) {
      throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH does not exist: ${absolute}`);
    }
    return { executablePath: absolute, source: 'environment' };
  }

  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled) && statSync(bundled).isFile()) {
      return { executablePath: bundled, source: 'playwright-package' };
    }
  } catch {
    // A mismatched local browser revision is recoverable when another cached
    // Chromium exists. Launch will still classify an unusable binary.
  }

  for (const root of cacheRoots()) {
    const matches = walkForExecutables(root)
      .filter(path => /(?:chromium|chrome-headless-shell)-\d+/.test(path))
      .sort()
      .reverse();
    if (matches.length) {
      return { executablePath: matches[0], source: 'playwright-browser-cache' };
    }
  }
  return { executablePath: null, source: 'playwright-default' };
}
