import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildFixture } from '../../../src/fixtures/builder.mjs';

const root = resolve(import.meta.dirname, '../../..');
const starter = join(root, 'cases/standard-chart-two-way-tree/fixture/starter');
const outputA = mkdtempSync(join(tmpdir(), 'vab-t12-export-a-'));
const outputB = mkdtempSync(join(tmpdir(), 'vab-t12-export-b-'));

try {
  for (const output of [outputA, outputB]) {
    const result = buildFixture({
      case_id: 'standard-chart-two-way-tree',
      source_root: starter,
      export_root: output,
      source_descriptor: {
        label: 'Deterministic synthetic StandardChart two-way tree starter generated for VAB-T12',
        source_type: 'synthetic',
      },
      exclusion: {
        paths: ['data/private/**', '**/*.answer.*', '**/*.reference.*'],
      },
      leakage: {
        path: [
          {
            id: 'production-extension-path',
            pattern: 'dvTwoWayTree|TwoWayTreeView|extension/series/dvTwoWayTree',
            recovery: 'Remove production extension paths; this fixture must remain synthetic.',
          },
        ],
        content: [
          {
            id: 'production-component-identifier',
            pattern: 'dvTwoWayTree|TwoWayTreeView|twoWayTree\\.js|StandardChartTwoWayTree',
            recovery: 'Remove production implementation identifiers from the starter.',
          },
          {
            id: 'production-network-reference',
            pattern: 'standard-chart\\.com|paradigm-chart|ainvest\\.com',
            recovery: 'Remove production URLs and repository references from worker-visible files.',
          },
          {
            id: 'production-history-reference',
            pattern: 'c2d5a3a7fffc789a06bbce73965ca2a59b72a5af|94c2a1c3|f7c74483',
            recovery: 'Remove production git history commit references from worker-visible files.',
          },
        ],
      },
      baseline: {
        build: { command: ['npm', 'run', 'build'], required: true },
        typecheck: { command: ['npm', 'run', 'typecheck'], required: true },
        test: { command: ['npm', 'test'], required: true },
      },
      provenance: [
        {
          kind: 'generated',
          label: 'Synthetic industry chain nodes, asymmetric edges, boundary tags, and starter scaffolding',
          source_type: 'synthetic',
          modified: false,
        },
      ],
      notes: ['Test export of the VAB-T12 worker-visible Starter.'],
    });
    assert.notEqual(result.status, 'error', result.summary);
  }

  const manifestA = JSON.parse(readFileSync(join(outputA, '.fixture/manifest.json'), 'utf8'));
  const manifestB = JSON.parse(readFileSync(join(outputB, '.fixture/manifest.json'), 'utf8'));
  assert.equal(manifestA.source_type, 'synthetic');
  assert.deepEqual(manifestA.leakage.finding_counts, { path: 0, content: 0, canary: 0 });
  assert.deepEqual(manifestB.leakage.finding_counts, { path: 0, content: 0, canary: 0 });
  assert.deepEqual(manifestA.baseline.steps.map(step => step.status), ['passed', 'passed', 'passed']);
  assert.ok(existsSync(join(outputA, 'dist/index.html')));
  assert.ok(existsSync(join(outputA, 'public/assets/sample-data.json')));

  const workerFiles = manifest => manifest.files
    .filter(entry => !entry.file.startsWith('.fixture/'))
    .map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 }));
  assert.deepEqual(workerFiles(manifestA), workerFiles(manifestB), 'worker-visible output must be deterministic');

  const source = readFileSync(join(outputA, 'public/assets/sample-data.json'), 'utf8');
  for (const forbidden of ['ainvest.com', 'standard-chart.com', 'paradigm-chart']) {
    assert.equal(source.toLocaleLowerCase('en').includes(forbidden), false, `worker source leaked ${forbidden}`);
  }

  // Sanity: the fixture must include the boundary cases the rubric exercises.
  const data = JSON.parse(source);
  const changeValues = data.nodes.map(node => node.changePct);
  assert.ok(changeValues.some(value => value == null));
  assert.ok(changeValues.some(value => value === 0));
  assert.ok(changeValues.some(value => value >= 30));
  assert.ok(changeValues.some(value => value <= -30));
  assert.ok(data.nodes.some(node => node.name.length > 40));

  console.log(JSON.stringify({
    status: 'success',
    summary: 'Two clean Fixture Builder exports passed with deterministic worker-visible hashes.',
    next_actions: [],
    artifacts: [
      join(outputA, '.fixture/manifest.json'),
      join(outputB, '.fixture/manifest.json'),
    ],
    leakage_finding_counts: manifestA.leakage.finding_counts,
  }));
} finally {
  rmSync(outputA, { recursive: true, force: true });
  rmSync(outputB, { recursive: true, force: true });
}
