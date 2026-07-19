import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildFixture } from '../../../src/fixtures/builder.mjs';

const root = resolve(import.meta.dirname, '../../..');
const starter = join(root, 'cases/ainvest-market-heatmap-rebuild/fixture/starter');
const outputA = mkdtempSync(join(tmpdir(), 'vab-t10-export-a-'));
const outputB = mkdtempSync(join(tmpdir(), 'vab-t10-export-b-'));

try {
  for (const output of [outputA, outputB]) {
    const result = buildFixture({
      case_id: 'ainvest-market-heatmap-rebuild',
      source_root: starter,
      export_root: output,
      source_descriptor: {
        label: 'Deterministic synthetic market heatmap starter generated for VAB-T10',
        source_type: 'synthetic',
      },
      exclusion: {
        paths: ['data/private/**', '**/*.answer.*', '**/*.reference.*'],
      },
      leakage: {
        path: [
          {
            id: 'production-component-path',
            pattern: 'widget-heatmap|HeatmapTreemapView',
            recovery: 'Remove production component paths; this fixture must remain synthetic.',
          },
        ],
        content: [
          {
            id: 'production-component-identifier',
            pattern: 'WidgetHeatmap|HeatmapTreemapView|useTreemapChart',
            recovery: 'Remove production implementation identifiers from the starter.',
          },
          {
            id: 'production-network-reference',
            pattern: 'ainvest\\.com|nova-market|ainvest-matrix-react',
            recovery: 'Remove production URLs and repository references from worker-visible files.',
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
          label: 'Synthetic market hierarchy and boundary data',
          source_type: 'synthetic',
          modified: false,
        },
      ],
      notes: ['Test export of the VAB-T10 worker-visible Starter.'],
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
  assert.equal(existsSync(join(outputA, 'control')), false);
  assert.equal(existsSync(join(outputA, 'provenance.md')), false);

  const workerFiles = manifest => manifest.files
    .filter(entry => !entry.file.startsWith('.fixture/'))
    .map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 }));
  assert.deepEqual(workerFiles(manifestA), workerFiles(manifestB), 'worker-visible output must be deterministic');

  const source = readFileSync(join(outputA, 'src/fixture-data.js'), 'utf8');
  for (const forbidden of ['ainvest.com', 'nova-market', 'ainvest-matrix-react']) {
    assert.equal(source.toLocaleLowerCase('en').includes(forbidden), false, `worker source leaked ${forbidden}`);
  }

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
