import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { buildRunSpec } from '../../src/control-plane/run-spec.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const runsRoot = join(projectRoot, '.local', 'runs');
const parentId = `test-visual-revision-parent-${process.pid}`;
const parentDir = join(runsRoot, parentId);
let childDir = null;

try {
  rmSync(parentDir, { recursive: true, force: true });
  mkdirSync(join(parentDir, 'workspace'), { recursive: true });
  cpSync(
    join(projectRoot, 'cases', 'narrative-equity-relationship', 'fixture', 'starter'),
    join(parentDir, 'workspace'),
    { recursive: true },
  );
  mkdirSync(join(parentDir, 'input'), { recursive: true });
  mkdirSync(join(parentDir, 'logs'), { recursive: true });
  const parentSpec = buildRunSpec({
    name: 'revision test parent',
    case_id: 'narrative-equity-relationship',
    engine: {
      adapter: 'codex', executable: 'codex', configured_model: 'fake-model', provider: 'test', credential_ref: 'secret://test',
    },
    workspace_root: join(parentDir, 'workspace'),
    wall_time_minutes: 10,
  });
  writeFileSync(join(parentDir, 'run-spec.json'), `${JSON.stringify(parentSpec, null, 2)}\n`);
  writeFileSync(join(parentDir, 'run-state.json'), JSON.stringify({
    run_id: parentId, status: 'awaiting-evaluation', process_pid: null,
    scenario: { stage_ids: ['S0'], completed_stages: ['S0'], attempts: { S0: 1 } },
  }, null, 2));
  writeFileSync(join(parentDir, 'result.json'), JSON.stringify({ status: 'success', run_id: parentId }, null, 2));

  const feedbackPath = join(parentDir, 'feedback.md');
  const referencePath = join(parentDir, 'layout reference.png');
  writeFileSync(feedbackPath, '# 视觉反馈\n\n节点间距需要更均匀，突出关系标签。\n');
  writeFileSync(referencePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const parentWorkspaceBefore = readFileSync(join(parentDir, 'workspace', 'index.html'), 'utf8');

  const created = spawnSync(process.execPath, [
    'scripts/bench.mjs', 'revise', '--parent-run', parentId,
    '--feedback', feedbackPath, '--reference', referencePath,
  ], { cwd: projectRoot, encoding: 'utf8', shell: false });
  assert.equal(created.status, 0, created.stderr || created.stdout);
  const envelope = JSON.parse(created.stdout);
  assert.equal(envelope.status, 'success');
  childDir = envelope.run_dir;
  assert.notEqual(childDir, parentDir);
  assert.ok(existsSync(join(childDir, 'workspace', 'index.html')));
  assert.ok(existsSync(join(childDir, 'workspace', '.vab', 'revision-inputs', 'feedback.md')));
  assert.ok(existsSync(join(childDir, 'workspace', '.vab', 'revision-inputs', 'images', 'reference-01.png')));
  assert.equal(existsSync(join(parentDir, 'workspace', '.vab', 'revision-inputs')), false);
  assert.equal(readFileSync(join(parentDir, 'workspace', 'index.html'), 'utf8'), parentWorkspaceBefore);

  const revision = JSON.parse(readFileSync(join(childDir, 'revision.json'), 'utf8'));
  assert.equal(revision.parent_run_id, parentId);
  assert.equal(revision.session_policy, 'fresh-focused');
  assert.equal(revision.references[0].path, '.vab/revision-inputs/images/reference-01.png');
  const childSpec = JSON.parse(readFileSync(join(childDir, 'run-spec.json'), 'utf8'));
  assert.equal('run_id' in childSpec, false);
  const state = JSON.parse(readFileSync(join(childDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'prepared');
  assert.deepEqual(state.scenario.stage_ids, ['R0', 'R1', 'R2']);
  const scenario = JSON.parse(readFileSync(join(childDir, 'scenario', 'stages.yaml'), 'utf8'));
  assert.deepEqual(scenario.stages.map(stage => stage.id), ['R0', 'R1', 'R2']);
  assert.match(scenario.stages[0].stakeholder_message, /ReadMediaFile/);
  assert.ok(existsSync(join(childDir, 'workspace', '.git')));
  process.stdout.write('visual feedback revision tests passed\n');
} finally {
  if (childDir) rmSync(childDir, { recursive: true, force: true });
  rmSync(parentDir, { recursive: true, force: true });
}
