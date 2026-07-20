import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildReport } from '../../src/reporting/builders.mjs';
import { renderHtml, renderMarkdown } from '../../src/reporting/render/index.mjs';
import { validateReport } from '../../src/reporting/validate.mjs';
import {
  acceptedDeliveryRate,
  aggregateHumanTouchTime,
  computeEffectiveSpeedup,
  p0StateFromEvaluator,
  summarizeCost,
} from '../../src/reporting/aggregate.mjs';
import {
  buildAcceptedEntry,
  buildBaseline,
  buildFailedEntry,
  buildPartialEntry,
  buildUnreviewedEntry,
} from './fixtures.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

function makeSingleRunReport() {
  return buildReport({
    entries: [buildAcceptedEntry()],
    reportId: 'demo-single',
    generatedAt: '2026-07-19T10:30:00Z',
    baseline: buildBaseline(),
  });
}

function makeCaseModelsReport() {
  return buildReport({
    entries: [
      buildAcceptedEntry({ runId: 'demo-accepted-codex', model: 'codex/gpt-5-codex' }),
      buildPartialEntry({ runId: 'demo-partial-kimi' }),
    ],
    reportId: 'demo-case-models',
    generatedAt: '2026-07-19T10:30:00Z',
    baseline: buildBaseline(),
  });
}

function makeModelCasesReport() {
  return buildReport({
    entries: [
      buildAcceptedEntry({ runId: 'kimi-macro', caseId: 'macro-map-3d-greenfield' }),
      buildAcceptedEntry({ runId: 'kimi-heatmap', caseId: 'ainvest-market-heatmap-rebuild' }),
      buildAcceptedEntry({ runId: 'kimi-equity', caseId: 'narrative-equity-relationship' }),
    ],
    reportId: 'demo-model-cases',
    generatedAt: '2026-07-19T10:30:00Z',
    baseline: buildBaseline(),
  });
}

const checks = [
  ['schema document parses and self-identifies', () => {
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'schemas', 'report.schema.json'), 'utf8'));
    assert.equal(schema.$id, 'https://vis-agent-bench.local/schemas/report.schema.json');
    assert.equal(schema.schema_version || schema.properties.schema_version.const, 1);
  }],

  ['single-run report validates against the schema', () => {
    const report = makeSingleRunReport();
    const result = validateReport(report);
    assert.equal(result.valid, true, JSON.stringify(result.errors.slice(0, 3), null, 2));
    assert.equal(report.view.kind, 'single-run');
    assert.equal(report.view.demo, true, 'DEMO marker must propagate to view.demo');
  }],

  ['case-models report validates against the schema', () => {
    const report = makeCaseModelsReport();
    const result = validateReport(report);
    assert.equal(result.valid, true, JSON.stringify(result.errors.slice(0, 3), null, 2));
    assert.equal(report.view.kind, 'case-models');
    assert.equal(report.view.scope.model_labels.length, 2);
  }],

  ['model-cases report validates against the schema', () => {
    const report = makeModelCasesReport();
    const result = validateReport(report);
    assert.equal(result.valid, true, JSON.stringify(result.errors.slice(0, 3), null, 2));
    assert.equal(report.view.kind, 'model-cases');
    assert.equal(report.case_conclusions.length, 3);
  }],

  ['visual feedback revision retains parent lineage in report evidence', () => {
    const entry = buildAcceptedEntry({ runId: 'revision-child' });
    entry.revision = {
      parent_run_id: 'parent-run',
      revision_index: 2,
      session_policy: 'fresh-focused',
      path: '/tmp/revision.json',
    };
    const report = buildReport({
      entries: [entry], reportId: 'revision-lineage', generatedAt: '2026-07-20T00:00:00Z', baseline: buildBaseline(),
    });
    assert.equal(validateReport(report).valid, true);
    assert.equal(report.data_provenance.inputs[0].parent_run_id, 'parent-run');
    assert.equal(report.data_provenance.inputs[0].revision_index, 2);
    assert.ok(report.evidence_index.some(item => item.handle === 'revision:revision-child'));
    assert.ok(report.fact_layers.machine.some(item => item.statement.includes('父 Run parent-run')));
  }],

  ['report is a deterministic function of its inputs (snapshot)', () => {
    const reportA = makeSingleRunReport();
    const reportB = makeSingleRunReport();
    assert.deepEqual(stripVolatile(reportA), stripVolatile(reportB));
  }],

  ['single-run report matches the committed snapshot', () => {
    const report = makeSingleRunReport();
    const snapshotPath = join(REPO_ROOT, 'tests', 'reporting', 'snapshots', 'single-run.report.json');
    const actual = JSON.stringify(report, null, 2);
    if (process.env.VAB_T07_UPDATE_SNAPSHOTS === '1') {
      mkdirSync(join(dirname(snapshotPath)), { recursive: true });
      writeFileSync(snapshotPath, `${actual}\n`);
      return;
    }
    assert.ok(existsSync(snapshotPath), `Snapshot missing. Re-run with VAB_T07_UPDATE_SNAPSHOTS=1 to create ${snapshotPath}.`);
    const expected = readFileSync(snapshotPath, 'utf8').trim();
    assert.equal(actual, expected, 'Single-run report drifted from snapshot. Re-run with VAB_T07_UPDATE_SNAPSHOTS=1 after review.');
  }],

  ['effective speedup is not eligible until at least one run is accepted', () => {
    const speedup = computeEffectiveSpeedup([buildUnreviewedEntry()], buildBaseline());
    assert.equal(speedup.eligible, false);
    assert.equal(speedup.ratio, null);
    assert.equal(speedup.source, 'unavailable');
  }],

  ['effective speedup returns null ratio when baseline is missing', () => {
    const speedup = computeEffectiveSpeedup([buildAcceptedEntry()], null);
    assert.equal(speedup.eligible, false);
    assert.equal(speedup.source, 'baseline-missing');
    assert.equal(speedup.ratio, null);
  }],

  ['accepted run without baseline does not claim that no delivery was accepted', () => {
    const report = buildReport({
      entries: [buildAcceptedEntry()],
      reportId: 'accepted-without-baseline',
      generatedAt: '2026-07-19T10:30:00Z',
    });
    assert.match(report.leadership_summary.headline, /已有交付通过验收/);
    assert.match(report.leadership_summary.headline, /人工基线/);
    assert.doesNotMatch(report.leadership_summary.headline, /尚无交付通过验收/);
  }],

  ['accepted delivery rate excludes unreviewed runs from the denominator', () => {
    const entries = [buildAcceptedEntry(), buildUnreviewedEntry(), buildPartialEntry()];
    const rate = acceptedDeliveryRate(entries);
    assert.equal(rate.reviewed, 2, 'Only reviewed runs should count.');
    assert.equal(rate.accepted, 1);
    assert.equal(rate.percent, 50);
    assert.equal(rate.source, 'human-review');
  }],

  ['human touch breakdown is unavailable when no review exists', () => {
    const breakdown = aggregateHumanTouchTime([buildUnreviewedEntry()]);
    assert.equal(breakdown.source, 'unavailable');
    assert.equal(breakdown.total_minutes, null);
  }],

  ['human touch breakdown is partial when only some runs are reviewed', () => {
    const breakdown = aggregateHumanTouchTime([buildAcceptedEntry(), buildUnreviewedEntry()]);
    assert.equal(breakdown.source, 'partial');
    assert.equal(breakdown.total_minutes, 400, 'Should sum accepted run minutes only.');
  }],

  ['cost summary marks unavailable when no run reports tokens or cost', () => {
    const summary = summarizeCost([buildUnreviewedEntry(), buildFailedEntry()]);
    assert.equal(summary.availability, 'unavailable');
    assert.equal(summary.reported_cost_usd, null);
    assert.equal(summary.reported_tokens, null);
    assert.match(summary.currency_note, /CLI 未上报 Token 用量/);
  }],

  ['cost summary marks partial when some runs report usage', () => {
    const summary = summarizeCost([buildAcceptedEntry(), buildUnreviewedEntry()]);
    assert.equal(summary.availability, 'partial');
    assert.equal(summary.reported_cost_usd, 0.12);
    assert.equal(summary.reported_tokens.input_tokens, 1200);
  }],

  ['p0 state falls back to unknown when evaluator is missing', () => {
    assert.equal(p0StateFromEvaluator(null), 'unknown');
    assert.equal(p0StateFromEvaluator({ summary: { p0_passed: true } }), 'passed');
    assert.equal(p0StateFromEvaluator({ summary: { score: 50, p0_min_score: 70 } }), 'failed');
  }],

  ['mixing DEMO and non-DEMO runs surfaces demo_inputs_present=true', () => {
    const report = buildReport({
      entries: [buildAcceptedEntry({ demo: false }), buildPartialEntry({ demo: true })],
      reportId: 'demo-mixed',
      generatedAt: '2026-07-19T10:30:00Z',
    });
    assert.equal(report.data_provenance.demo_inputs_present, true);
    assert.equal(report.view.demo, true);
    assert.equal(report.result_envelope.status, 'warning');
  }],

  ['report handles run with no human_review and no evaluator gracefully', () => {
    const report = buildReport({
      entries: [buildUnreviewedEntry()],
      reportId: 'demo-bare',
      generatedAt: '2026-07-19T10:30:00Z',
    });
    const result = validateReport(report);
    assert.equal(result.valid, true, JSON.stringify(result.errors.slice(0, 3), null, 2));
    assert.equal(report.leadership_summary.accepted_delivery_rate.source, 'unavailable');
    assert.equal(report.human_touch_breakdown.source, 'unavailable');
    assert.equal(report.leadership_summary.effective_speedup.eligible, false);
    // The report must still produce a complete fact layer set and a valid
    // evidence completeness snapshot even when no human review is present.
    assert.ok(Array.isArray(report.fact_layers.machine));
    assert.ok(Array.isArray(report.fact_layers.unverified));
    assert.equal(report.evidence_completeness.missing.includes('human-review'), true);
  }],

  ['CLI failure runs surface as machine failure modes', () => {
    const report = buildReport({
      entries: [buildFailedEntry()],
      reportId: 'demo-failed',
      generatedAt: '2026-07-19T10:30:00Z',
    });
    assert.ok(report.failure_modes.some(f => f.source === 'machine' && f.title.includes('未正常完成')));
    assert.ok(report.failure_modes.some(f => f.source === 'machine' && /自动评估器/.test(f.title)));
    const caseConclusion = report.case_conclusions[0];
    assert.equal(caseConclusion.p0_state, 'failed');
    assert.equal(caseConclusion.decision, null);
  }],

  ['markdown renderer includes demo ribbon and unavailable markers', () => {
    const report = makeSingleRunReport();
    const md = renderMarkdown(report);
    assert.match(md, /演示数据/);
    assert.match(md, /## 管理结论/);
    assert.match(md, /## 人工介入时间/);
    assert.match(md, /## 事实分层/);
    assert.match(md, /## 数据来源/);
  }],

  ['markdown renderer handles reports with no human review', () => {
    const report = buildReport({
      entries: [buildUnreviewedEntry()],
      reportId: 'demo-bare',
      generatedAt: '2026-07-19T10:30:00Z',
    });
    const md = renderMarkdown(report);
    assert.match(md, /尚无已完成的人工评审/);
    assert.match(md, /暂不能计算有效提效倍数/);
  }],

  ['html renderer produces a self-contained document', () => {
    const report = makeSingleRunReport();
    const html = renderHtml(report);
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<\/html>/);
    assert.match(html, /<style>/);
    assert.doesNotMatch(html, /<script/);
  }],

  ['html renderer escapes untrusted content', () => {
    const entry = buildAcceptedEntry();
    entry.human_review.reviews[0].observations.problems = '<script>alert(1)</script> & more';
    const report = buildReport({
      entries: [entry],
      reportId: 'demo-escape',
      generatedAt: '2026-07-19T10:30:00Z',
    });
    const html = renderHtml(report);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
  }],

  ['validator rejects report with missing required field', () => {
    const report = makeSingleRunReport();
    delete report.leadership_summary;
    const result = validateReport(report);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.path === '$.leadership_summary' && e.code === 'REQUIRED'));
  }],

  ['validator rejects verdict outside enum', () => {
    const report = makeSingleRunReport();
    report.leadership_summary.verdict = 'super-model';
    const result = validateReport(report);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.path === '$.leadership_summary.verdict' && e.code === 'ENUM'));
  }],

  ['validator rejects unexpected top-level field', () => {
    const report = makeSingleRunReport();
    report.leaderboard_score = 0.99;
    const result = validateReport(report);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.code === 'UNEXPECTED_FIELD'));
  }],

  ['builder throws when no entries are provided', () => {
    assert.throws(() => buildReport({ entries: [], reportId: 'x', generatedAt: '2026-07-19T10:30:00Z' }), /At least one report entry/);
  }],

  ['generate-report CLI builds all three formats and validates', () => {
    const tmpRoot = join(tmpdir(), `vab-t07-cli-${Date.now()}`);
    const runDir = join(tmpRoot, 'run-accepted');
    mkdirSync(runDir, { recursive: true });
    const entry = buildAcceptedEntry({ demo: false });
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(entry.run, null, 2));
    writeFileSync(join(runDir, 'evaluator-summary.json'), JSON.stringify(entry.evaluator, null, 2));
    writeFileSync(join(runDir, 'human-review.json'), JSON.stringify(entry.human_review, null, 2));
    writeFileSync(join(runDir, 'isolation.json'), JSON.stringify(entry.isolation, null, 2));
    const baselinePath = join(tmpRoot, 'baseline.json');
    writeFileSync(baselinePath, JSON.stringify(buildBaseline(), null, 2));
    const outDir = join(tmpRoot, 'out');

    const result = spawnSync(process.execPath, [
      join(REPO_ROOT, 'scripts', 'generate-report.mjs'),
      '--run', runDir,
      '--baseline', baselinePath,
      '--out-dir', outDir,
      '--report-id', 'cli-smoke',
      '--format', 'all',
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, `CLI exited non-zero: ${result.stderr}\n${result.stdout}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'success');
    assert.equal(payload.view, 'single-run');
    assert.equal(payload.artifacts.length, 3);
    for (const artifact of payload.artifacts) assert.ok(existsSync(artifact), `Missing artifact: ${artifact}`);

    const jsonPath = payload.artifacts.find(p => p.endsWith('.json'));
    const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const validation = validateReport(report);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors.slice(0, 3), null, 2));

    rmSync(tmpRoot, { recursive: true, force: true });
  }],

  ['generate-report CLI fails fast on a missing run directory', () => {
    const result = spawnSync(process.execPath, [
      join(REPO_ROOT, 'scripts', 'generate-report.mjs'),
      '--run', '/does/not/exist/run-001',
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'error');
    assert.ok(payload.error.safe_retry);
  }],
];

function stripVolatile(report) {
  // report_id / generated_at are inputs, not derived; everything else must be stable.
  return JSON.parse(JSON.stringify(report));
}

function dirname(path) {
  return path.split('/').slice(0, -1).join('/');
}

const failures = [];
for (const [name, check] of checks) {
  try {
    check();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures.push({ name, error: error.message });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  }
}

process.stdout.write(`${JSON.stringify({
  status: failures.length ? 'error' : 'success',
  summary: `${checks.length - failures.length}/${checks.length} reporting checks passed.`,
  next_actions: failures.length ? failures.map(f => `Fix: ${f.name}`) : ['Wire report generation into the integration task once evaluators and human reviews exist.'],
  artifacts: ['tests/reporting/run.mjs'],
  ...(failures.length ? { failures } : {}),
}, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
