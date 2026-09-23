#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function collectFiles(dir, extensions = new Set(['.js', '.mjs']), ignoreDirs = new Set(['node_modules', '.git', '.temp', 'tmp', 'dist', 'coverage'])) {
  const results = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (ignoreDirs.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...collectFiles(fullPath, extensions, ignoreDirs));
      } else if (stat.isFile() && extensions.has(extname(entry))) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}

const targetDirs = [
  join(root, 'scripts'),
  join(root, 'src'),
  join(root, 'prototype/assets'),
  join(root, 'cases'),
];

const filesToCheck = [];
for (const dir of targetDirs) {
  filesToCheck.push(...collectFiles(dir));
}

let checkedCount = 0;
const errors = [];

for (const file of filesToCheck) {
  checkedCount++;
  const proc = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    shell: false,
    timeout: 10_000,
  });

  if (proc.status !== 0 || proc.error) {
    errors.push({
      file,
      error: proc.error ? proc.error.message : (proc.stderr || proc.stdout || 'Syntax check failed').trim(),
    });
  }
}

if (errors.length > 0) {
  process.stderr.write(`Syntax check failed on ${errors.length}/${checkedCount} files:\n`);
  for (const err of errors) {
    process.stderr.write(`- ${err.file}: ${err.error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    status: 'success',
    summary: `Syntax check passed for all ${checkedCount} JavaScript/MJS files.`,
    next_actions: [],
    artifacts: ['scripts/check-syntax.mjs'],
  }, null, 2) + '\n');
}
