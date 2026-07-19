#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCapture, listDrivers } from '../src/browser-evidence/index.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(args) {
  const parsed = { _: [], options: {} };
  let currentKey = null;
  for (const value of args) {
    if (value.startsWith('--')) {
      if (currentKey) parsed.options[currentKey] = true;
      currentKey = value.slice(2).replaceAll('-', '_');
    } else if (currentKey) {
      parsed.options[currentKey] = value;
      currentKey = null;
    } else {
      parsed._.push(value);
    }
  }
  if (currentKey) parsed.options[currentKey] = true;
  return parsed;
}

function usage() {
  return [
    'Usage: node scripts/capture-browser-evidence.mjs <spec.yaml|spec.json> [--driver static-fixture] [--out-dir <dir>]',
    '',
    '  The capture spec declares url/fixture, viewport, wait, actions and capture toggles.',
    '  Use a relative fixture_dir to keep capture offline and deterministic.',
    '',
    'Drivers:',
    `  ${listDrivers().join(', ')}`,
  ].join('\n');
}

function output(status, summary, nextActions = [], artifacts = [], extra = {}) {
  process.stdout.write(`${JSON.stringify({
    status,
    summary,
    next_actions: nextActions,
    artifacts,
    ...extra,
  }, null, 2)}\n`);
}

async function loadSpec(specPath) {
  const raw = readFileSync(specPath, 'utf8');
  if (specPath.endsWith('.json')) return JSON.parse(raw);
  if (specPath.endsWith('.yaml') || specPath.endsWith('.yml')) {
    const { parse: parseYaml } = await import('yaml');
    return parseYaml(raw);
  }
  return JSON.parse(raw);
}

function writeArtifacts() {
  return (target, name, buffer) => {
    mkdirSync(target, { recursive: true });
    const file = join(target, name);
    writeFileSync(file, buffer);
    return file;
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const parsed = parseArgs(argv);
  const specPath = parsed._[0];
  if (!specPath) {
    output('error', 'Missing capture spec path.', ['Provide a path to a JSON or YAML capture spec.']);
    process.exitCode = 1;
    return;
  }
  const specAbs = resolve(process.cwd(), specPath);
  let spec;
  try {
    spec = await loadSpec(specAbs);
  } catch (error) {
    output('error', `Failed to read capture spec: ${error.message}`, ['Fix the spec file and retry.']);
    process.exitCode = 1;
    return;
  }
  const outDir = parsed.options.out_dir ? resolve(process.cwd(), parsed.options.out_dir) : join(dirname(specAbs), 'browser-evidence');
  const driver = parsed.options.driver ?? 'static-fixture';

  // Capture spec resolves fixture_dir relative to the spec file location.
  const result = await runCapture(spec, {
    root: dirname(specAbs),
    driver,
    outDir,
    writeArtifact: writeArtifacts(),
  });
  const summary = `${result.summary} (driver=${driver})`;
  const next = result.status === 'success'
    ? [`Open ${join(outDir, 'browser-evidence.json')} in the review prototype to begin human review.`]
    : result.next_actions;
  output(result.status, summary, next, result.artifacts, {
    case_id: spec.case_id,
    run_id: spec.run_id,
    capture_id: spec.capture_id,
    driver,
    out_dir: outDir,
    failures: result.errors,
  });
  if (result.status === 'error') process.exitCode = 1;
}

// `projectRoot` is exported indirectly via the resolved spec path; kept here
// for future integration tests that assert the CLI's CWD handling.
export { projectRoot };

main().catch(error => {
  output('error', error.message, ['Internal capture CLI error; report to VAB-T06 owner.']);
  process.exitCode = 1;
});
