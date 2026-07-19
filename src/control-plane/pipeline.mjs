import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { createPlaywrightDriver } from '../browser-evidence/drivers/index.mjs';
import { buildFixture } from '../fixtures/builder.mjs';
import { buildHumanReviewPackage } from '../review/human-review-package.mjs';
import { buildReport } from '../reporting/builders.mjs';
import { loadEntry } from '../reporting/load.mjs';
import { renderHtml, renderMarkdown } from '../reporting/render/index.mjs';
import { validateReport } from '../reporting/validate.mjs';
import { containedRunDirectory } from '../core/run-id.mjs';
import { getCaseRuntime } from './case-registry.mjs';
import { loadCheckpoints, runCheckpoint, saveCheckpoints } from './checkpoints.mjs';
import {
  attachProductionProvenance,
  loadGoldenObservation,
  sha256,
} from './golden-observations.mjs';
import { assertValidRunSpec } from './run-spec.mjs';

export async function runGoldenPipeline({
  projectRoot,
  spec,
  outRoot,
  runId,
  failAfter = null,
  resume = false,
}) {
  assertValidRunSpec(spec);
  const id = runId || `golden-${spec.case_id}-${randomUUID().slice(0, 8)}`;
  const runDir = containedRunDirectory(outRoot, id);
  initialiseRunDir(runDir);
  const runtime = getCaseRuntime(projectRoot, spec.case_id);
  const specPath = join(runDir, 'run-spec.json');
  if (!existsSync(specPath)) writeJson(specPath, { ...spec, run_id: id });
  const state = loadCheckpoints(runDir, sha256(JSON.stringify(spec)));
  const results = {};

  try {
    results.validate = await checkpoint('validate', async () => {
      assertValidRunSpec(spec);
      return envelope('success', `RunSpec ${spec.name} is valid.`, [], [specPath]);
    });
    maybeFail(failAfter, 'validate');

    results.fixture = await checkpoint('fixture', async () => {
      const plan = parseYaml(readFileSync(runtime.plan, 'utf8'));
      const result = buildFixture({
        case_id: spec.case_id,
        source_root: runtime.starter,
        export_root: join(runDir, 'workspace'),
        source_descriptor: {
          label: plan.source?.label || spec.case_id,
          source_type: plan.source?.type || 'synthetic',
        },
        exclusion: plan.exclusion,
        leakage: plan.leakage,
        baseline: plan.baseline,
        provenance: plan.provenance || [],
        patches: plan.patches || [],
        canary_names: plan.canary_names || [],
        notes: [...(plan.notes || []), 'Built by the checkpointed VAB-T08 golden pipeline.'],
      });
      if (result.status === 'error') return result;
      writeJson(join(runDir, 'isolation.json'), {
        mode: 'file-isolated-development',
        leaderboard_eligible: false,
        fixture_digest: result.manifest.export.fixture_digest,
        warning: 'File isolation does not prevent same-user host reads; use container or dedicated user for ranking.',
      });
      return result;
    });
    maybeFail(failAfter, 'fixture');

    results.run = await checkpoint('run', async () => runFakeStages({
      projectRoot,
      runtime,
      spec,
      runId: id,
      runDir,
    }));
    maybeFail(failAfter, 'run');

    results.capture = await checkpoint('capture', async () => captureFakeCandidate({
      runId: id,
      caseId: spec.case_id,
      runDir,
    }));
    maybeFail(failAfter, 'capture');

    results.evaluate = await checkpoint('evaluate', async () => evaluateGolden({
      projectRoot,
      runtime,
      runId: id,
      runDir,
    }));
    maybeFail(failAfter, 'evaluate');

    results.review = await checkpoint('review', async () => createReviewPlaceholder({
      runId: id,
      caseId: spec.case_id,
      runDir,
    }));
    maybeFail(failAfter, 'review');

    results.report = await checkpoint('report', async () => generateRunReport({
      runId: id,
      caseId: spec.case_id,
      runDir,
    }));
    maybeFail(failAfter, 'report');
  } catch (error) {
    return envelope(
      'error',
      error.message,
      [`Resume with the same --run-id "${id}" and --resume after fixing the failure.`],
      [saveCheckpoints(runDir, state)],
      {
        error: {
          root_cause_hint: error.message,
          safe_retry: 'Rerun with the same run id; completed checkpoints will be reused.',
          stop_condition: 'Stop after two identical failures at the same checkpoint.',
        },
        run_id: id,
        run_dir: runDir,
        checkpoints: state,
      },
    );
  }

  return envelope(
    'success',
    `Golden pipeline completed for ${spec.case_id}${resume ? ' after resume' : ''}.`,
    ['Open the HTML report, then replace the human-review placeholder with a real review.'],
    [
      specPath,
      join(runDir, 'result.json'),
      join(runDir, 'evaluator-summary.json'),
      join(runDir, 'browser-evidence.json'),
      join(runDir, 'human-review.json'),
      join(runDir, 'reports', `${id}.html`),
      join(runDir, 'logs', 'checkpoints.json'),
    ],
    { run_id: id, run_dir: runDir, checkpoints: state, steps: results },
  );

  async function checkpoint(name, execute) {
    return runCheckpoint({ runDir, id: name, state, execute });
  }
}

async function runFakeStages({ runtime, spec, runId, runDir }) {
  const scenario = parseYaml(readFileSync(join(runtime.caseDir, 'scenario/stages.yaml'), 'utf8'));
  const stageRoot = join(runDir, 'logs', 'stages');
  const stages = [];
  mkdirSync(stageRoot, { recursive: true });
  for (const stage of scenario.stages) {
    const stageDir = join(stageRoot, stage.id);
    mkdirSync(stageDir, { recursive: true });
    const prompt = stage.input
      ? readFileSync(join(runtime.caseDir, 'scenario', stage.input), 'utf8')
      : stage.stakeholder_message;
    writeFileSync(join(stageDir, 'prompt.md'), prompt);
    writeJson(join(stageDir, 'events.json'), {
      adapter: 'deterministic-fake',
      stage_id: stage.id,
      status: 'success',
      checkpoint: stage.checkpoint,
      emitted_at: '2000-01-01T00:00:00.000Z',
    });
    stages.push({ stage_id: stage.id, status: 'success', duration_ms: 1 });
  }
  const candidate = fakeCandidateHtml(spec.case_id);
  writeFileSync(join(runDir, 'workspace', 'benchmark-candidate.html'), candidate);
  writeJson(join(runDir, 'logs', 'commands.json'), {
    adapter: 'deterministic-fake',
    stages: stages.map(item => ({ stage_id: item.stage_id, executable: '<fake>', args: [] })),
  });
  writeFileSync(join(runDir, 'artifacts', 'workspace.diff'), [
    'diff --git a/benchmark-candidate.html b/benchmark-candidate.html',
    'new file mode 100644',
    `+sha256:${sha256(candidate)}`,
    '',
  ].join('\n'));
  const result = {
    status: 'success',
    run_id: runId,
    case_id: spec.case_id,
    engine: {
      adapter: 'deterministic-fake',
      configured_model: 'golden-fixture',
      provider: 'local',
      requested_engine: spec.engine,
    },
    isolation: {
      mode: 'file-isolated-development',
      leaderboard_eligible: false,
    },
    usage: {
      availability: 'unavailable',
      input_tokens: null,
      output_tokens: null,
      cached_tokens: null,
      cost_usd: null,
    },
    duration_ms: stages.length,
    stages,
    human_review_status: 'pending',
    demo: true,
    completed_at: '2000-01-01T00:00:00.000Z',
  };
  writeJson(join(runDir, 'result.json'), result);
  return envelope('success', `${stages.length} fake stages completed.`, [], [
    join(runDir, 'result.json'),
    stageRoot,
    join(runDir, 'artifacts', 'workspace.diff'),
  ], { stage_count: stages.length });
}

async function captureFakeCandidate({ runId, caseId, runDir }) {
  const root = join(runDir, 'workspace');
  const server = createStaticServer(root);
  const address = await listen(server);
  const origin = `http://127.0.0.1:${address.port}`;
  const outDir = join(runDir, 'artifacts', 'browser');
  try {
    const result = await createPlaywrightDriver().capture({
      schema_version: 1,
      capture_id: `${runId}-browser`,
      run_id: runId,
      case_id: caseId,
      viewport: { width: 1280, height: 800 },
      capture_deadline_ms: 30_000,
      steps: [
        { kind: 'goto', url: `${origin}/benchmark-candidate.html` },
        { kind: 'assert-visible', selector: '#candidate-root' },
        { kind: 'click', selector: '#exercise' },
        { kind: 'assert-text', selector: '#status', text: 'interaction-ok', match: 'exact' },
        { kind: 'collect-state', label: 'candidate-state', selectors: ['#candidate-root', '#status', 'canvas'] },
        { kind: 'screenshot', label: 'candidate-final', full_page: true },
      ],
    }, {
      outDir,
      policy: { allowed_origins: [origin], allowed_file_roots: [] },
    });
    if (result.evidence) writeJson(join(runDir, 'browser-evidence.json'), result.evidence);
    return result;
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
}

async function evaluateGolden({ projectRoot, runtime, runId, runDir }) {
  const browserEvidence = readJson(join(runDir, 'browser-evidence.json'));
  const baseObservation = loadGoldenObservation(projectRoot, runtime.caseId, browserEvidence);
  const commandSource = structuredClone(baseObservation);
  const hiddenSource = structuredClone(baseObservation);
  const browserSource = structuredClone(baseObservation);
  browserSource._captured_browser_evidence = browserEvidence;
  const sources = {
    fixture_manifest: readFileSync(join(runDir, 'workspace', '.fixture', 'manifest.json'), 'utf8'),
    command_evidence: JSON.stringify(commandSource),
    browser_evidence: JSON.stringify(browserSource),
    hidden_control_execution: JSON.stringify(hiddenSource),
  };
  const digests = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, sha256(value)]));
  const observation = attachProductionProvenance(baseObservation, digests);
  const observationText = JSON.stringify(observation);
  writeFileSync(join(runDir, 'observation.json'), observationText);
  for (const [name, content] of Object.entries(sources)) {
    writeFileSync(join(runDir, `${name}.json`), content);
  }
  const attestation = {
    schema_version: 1,
    kind: 'trusted-observation-attestation',
    run_id: runId,
    case_id: runtime.caseId,
    collector: {
      id: 'vab-deterministic-golden-collector',
      version: '1',
      demo_only: true,
      conclusion_eligible: false,
    },
    bindings: {
      observation: { path: 'observation.json', sha256: sha256(observationText) },
      ...Object.fromEntries(Object.keys(sources).map(name => [
        name,
        { path: `${name}.json`, sha256: digests[name] },
      ])),
    },
  };
  writeJson(join(runDir, 'observation-attestation.json'), attestation);
  const evaluation = await runtime.evaluator({
    runId,
    runRoot: runDir,
    attestationPath: 'observation-attestation.json',
    workspace: join(runDir, 'workspace'),
    logsDir: join(runDir, 'logs', 'evaluator'),
  });
  const summary = {
    ...evaluation,
    summary: {
      p0_state: evaluation.status === 'success' ? 'passed' : 'failed',
      score: evaluation.scorecard?.total ?? null,
      p0_min_score: 80,
    },
    demo_only: true,
    conclusion_eligible: false,
  };
  writeJson(join(runDir, 'evaluator-summary.json'), summary);
  return envelope(evaluation.status, `Evaluator completed with score ${evaluation.scorecard?.total ?? 'unknown'}.`, [], [
    join(runDir, 'evaluator-summary.json'),
    join(runDir, 'observation-attestation.json'),
  ], { score: evaluation.scorecard?.total ?? null });
}

function createReviewPlaceholder({ runId, caseId, runDir }) {
  const browser = readJson(join(runDir, 'browser-evidence.json'));
  const pkg = buildHumanReviewPackage({
    run_id: runId,
    reviewer: 'pending-human-review',
    isolation: 'file-isolated-development',
    machine_evidence_ref: 'browser-evidence.json',
    blind_review: true,
    reviews: [{
      case_id: caseId,
      complete: false,
      decision: null,
      machine_evidence: {
        run_id: runId,
        capture_id: browser.capture_id,
        captured_at: browser.captured_at,
      },
      scores: {},
      human_time: {},
      convergence: {},
      observations: {
        strengths: '',
        problems: '',
        required_fixes: '',
        management_judgment: '',
      },
    }],
  });
  writeJson(join(runDir, 'human-review.json'), pkg);
  return envelope('success', 'Human-review placeholder created.', [
    'Open the review page and replace placeholder values before leadership publication.',
  ], [join(runDir, 'human-review.json')]);
}

function generateRunReport({ runId, caseId, runDir }) {
  const entry = loadEntry(runDir, {
    demo: true,
    caseMeta: { title: caseId },
  });
  const report = buildReport({
    entries: [entry],
    reportId: runId,
    generatedAt: new Date().toISOString(),
    scopeHint: 'single-run',
    title: `Vis Agent Bench · ${caseId}`,
  });
  const validation = validateReport(report);
  if (!validation.valid) throw new Error(`Generated report is invalid: ${JSON.stringify(validation.errors)}`);
  const reportDir = join(runDir, 'reports');
  mkdirSync(reportDir, { recursive: true });
  writeJson(join(reportDir, `${runId}.json`), report);
  writeFileSync(join(reportDir, `${runId}.md`), renderMarkdown(report));
  writeFileSync(join(reportDir, `${runId}.html`), renderHtml(report));
  return envelope('success', 'JSON, Markdown, and HTML report generated.', [], [
    join(reportDir, `${runId}.json`),
    join(reportDir, `${runId}.md`),
    join(reportDir, `${runId}.html`),
  ], { evidence_completeness: report.evidence_completeness.percent });
}

function fakeCandidateHtml(caseId) {
  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>VAB Golden ${escapeHtml(caseId)}</title>
<style>body{font-family:system-ui;margin:0;padding:32px;background:#0b1020;color:#eef2ff}main{max-width:960px;margin:auto}canvas{width:100%;height:420px;background:#172554;border:1px solid #60a5fa}button{padding:10px 16px;margin:12px 0}</style>
<main id="candidate-root"><h1>${escapeHtml(caseId)}</h1><p>Deterministic fake adapter candidate. This page proves harness wiring only.</p><button id="exercise">Exercise interaction</button><output id="status">ready</output><canvas width="960" height="420"></canvas></main>
<script>const c=document.querySelector('canvas');const x=c.getContext('2d');x.fillStyle='#22d3ee';x.fillRect(40,40,280,160);document.querySelector('#exercise').onclick=()=>{document.querySelector('#status').textContent='interaction-ok';x.fillStyle='#f59e0b';x.fillRect(360,80,240,220)};</script></html>`;
}

function createStaticServer(root) {
  return createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const name = basename(pathname);
    const target = join(root, name || 'benchmark-candidate.html');
    if (!existsSync(target)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(readFileSync(target));
  });
}

function listen(server) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address()));
  });
}

function initialiseRunDir(runDir) {
  for (const path of [
    runDir,
    join(runDir, 'logs'),
    join(runDir, 'logs', 'checkpoints'),
    join(runDir, 'artifacts'),
    join(runDir, 'input'),
  ]) mkdirSync(path, { recursive: true });
}

function maybeFail(target, completedStep) {
  if (target === completedStep) {
    throw new Error(`Injected failure after checkpoint "${completedStep}".`);
  }
}

function envelope(status, summary, nextActions = [], artifacts = [], extra = {}) {
  return { status, summary, next_actions: nextActions, artifacts, ...extra };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function reportUrl(path) {
  return pathToFileURL(path).href;
}
