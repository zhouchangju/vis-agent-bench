#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createPlaywrightDriver } from '../src/browser-evidence/drivers/index.mjs';

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function usage() {
  return [
    'Usage: node scripts/capture-playwright-evidence.mjs <spec.json> --out-dir <directory>',
    '  [--allow-origin <exact-loopback-origin>]... [--allow-file-root <fixture-directory>]...',
  ].join('\n');
}

function valuesFor(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const specPath = resolve(args[0]);
  const outIndex = args.indexOf('--out-dir');
  const outDir = outIndex >= 0 && args[outIndex + 1]
    ? resolve(args[outIndex + 1])
    : resolve(dirname(specPath), 'playwright-evidence');
  let spec;
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch (error) {
    output({
      status: 'error',
      summary: `Failed to read JSON spec: ${error.message}`,
      next_actions: ['Provide a valid declarative JSON smoke spec.'],
      artifacts: [],
      errors: [{ code: 'SPEC_INVALID', message: error.message }],
    });
    process.exitCode = 1;
    return;
  }
  const result = await createPlaywrightDriver().capture(spec, {
    outDir,
    policy: {
      allowed_origins: valuesFor(args, '--allow-origin'),
      allowed_file_roots: valuesFor(args, '--allow-file-root'),
    },
  });
  output(result);
  if (result.status === 'error') process.exitCode = 1;
}

main().catch(error => {
  output({
    status: 'error',
    summary: error.message,
    next_actions: ['Inspect the Playwright Driver implementation.'],
    artifacts: [],
    errors: [{ code: 'CAPTURE_INCOMPLETE', message: error.message }],
  });
  process.exitCode = 1;
});
