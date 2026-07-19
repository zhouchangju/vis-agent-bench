import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveExclusionConfig,
  compileExclusionFilter,
  compileGlob,
  DEFAULT_EXCLUSION_GROUPS,
} from '../../src/fixtures/exclusion.mjs';
import {
  buildRuleSet,
  mergeLegacyRules,
  normalizeRule,
  scanWorkspace,
  hashRuleSet,
} from '../../src/fixtures/leakage.mjs';
import {
  resolveBaselineSteps,
  runBaselineGate,
} from '../../src/fixtures/baseline-gate.mjs';
import {
  MANIFEST_VERSION,
  computeFixtureDigest,
  serialiseManifest,
  validateManifest,
} from '../../src/fixtures/manifest.mjs';
import { buildFixture, BUILDER_VERSION } from '../../src/fixtures/builder.mjs';
import {
  scanForAnswerLeakage,
  copyWorkspaceWithExclusion,
  listFiles,
} from '../../src/core/file-isolation.mjs';

// ----- helpers --------------------------------------------------------------

function isRegExp(value) {
  return Object.prototype.toString.call(value) === '[object RegExp]';
}

function makeTree(root, entries) {
  for (const [path, content] of Object.entries(entries)) {
    const abs = join(root, path);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
}

function makeWorkspace(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vab-fixture-test-'));
  const defaults = {
    'package.json': JSON.stringify({ name: 'demo', scripts: {} }, null, 2),
    'README.md': '# Demo scaffold\n',
    'src/index.ts': 'export const greeting = "hello";\n',
    'data/sample.json': JSON.stringify({ nodes: [] }, null, 2),
  };
  makeTree(dir, { ...defaults, ...overrides });
  return dir;
}

const cleanups = [];
function track(dir) {
  cleanups.push(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
}
function cleanupAll() {
  while (cleanups.length) cleanups.pop()();
}

// ----- checks ---------------------------------------------------------------

const checks = [
  ['exclusion defaults drop .git, node_modules and build artefacts', () => {
    const filter = compileExclusionFilter(resolveExclusionConfig());
    assert.equal(filter('node_modules', false), true);
    assert.equal(filter('src/components/node_modules', false), true);
    assert.equal(filter('.git', false), true);
    assert.equal(filter('dist/index.js', false), true);
    assert.equal(filter('src/index.ts', false), false);
  }],

  ['compileGlob matches single-segment and multi-segment patterns', () => {
    assert.equal(compileGlob('*.secret')('foo.secret'), true);
    assert.equal(compileGlob('*.secret')('nested/foo.secret'), false);
    assert.equal(compileGlob('src/**/*.secret')('src/a/b/c.secret'), true);
    assert.equal(compileGlob('src/**/*.secret')('src/top.secret'), true);
    assert.equal(compileGlob('**/*.lock')('a/b.lock'), true);
    assert.equal(compileGlob('{a,b}.md')('a.md'), true);
    assert.equal(compileGlob('{a,b}.md')('b.md'), true);
    assert.equal(compileGlob('{a,b}.md')('c.md'), false);
  }],

  ['Case-declared exclusion merges with defaults and supports extra globs', () => {
    const config = resolveExclusionConfig({
      groups: { docs: ['INTERNAL.md'] },
      glob: ['**/*.answer'],
    });
    const filter = compileExclusionFilter(config);
    assert.equal(filter('INTERNAL.md', false), true);
    assert.equal(filter('src/foo.answer', false), true);
    assert.equal(filter('node_modules', false), true); // defaults still apply
    assert.equal(filter('src/index.ts', false), false);
  }],

  ['exclusion extend_defaults=false drops the built-in groups', () => {
    const config = resolveExclusionConfig({ extend_defaults: false, glob: ['only-this.txt'] });
    const filter = compileExclusionFilter(config);
    assert.equal(filter('node_modules', false), false);
    assert.equal(filter('only-this.txt', false), true);
  }],

  ['DEFAULT_EXCLUSION_GROUPS covers git, deps, caches, answer indices and editor metadata', () => {
    for (const key of ['git', 'deps', 'caches', 'answer', 'docs', 'editor']) {
      assert.ok(Array.isArray(DEFAULT_EXCLUSION_GROUPS[key]), `missing group ${key}`);
    }
    assert.ok(DEFAULT_EXCLUSION_GROUPS.git.includes('.git'));
    assert.ok(DEFAULT_EXCLUSION_GROUPS.answer.some(p => /index/i.test(p)));
  }],

  ['normalizeRule accepts regex, string and object shapes', () => {
    const fromRegex = normalizeRule(/FooBar/);
    assert.ok(isRegExp(fromRegex.pattern));
    assert.ok(fromRegex.pattern.test('aFooBarb'));
    assert.equal(normalizeRule('EquityController').pattern.test('equitycontroller'), true);
    const custom = normalizeRule({ id: 'canary-x', pattern: 'SECRET-CANARY', recovery: 'Strip the marker.' });
    assert.equal(custom.id, 'canary-x');
    assert.equal(custom.recovery, 'Strip the marker.');
    assert.equal(normalizeRule(null), null);
  }],

  ['buildRuleSet splits path/content/canary and supports legacy flat lists', () => {
    const set = buildRuleSet({
      path: ['answer_impl.ts'],
      content: [{ id: 'ctrl', pattern: /EquityController/, recovery: 'Remove the controller.' }],
      canary: ['SECRET-CANARY-MARKER'],
      rules: ['legacy-literal'],
    }, 'demo');
    assert.equal(set.path.length, 1);
    assert.equal(set.content.length, 2); // declared + legacy flat
    assert.equal(set.canary.length, 1);
  }],

  ['hashRuleSet is stable for identical inputs', () => {
    const a = buildRuleSet({ content: ['foo'] }, 'x');
    const b = buildRuleSet({ content: ['foo'] }, 'x');
    assert.equal(hashRuleSet(a), hashRuleSet(b));
  }],

  ['scanWorkspace reports path, content and canary findings with recovery hints', () => {
    const ws = makeWorkspace({
      'src/EquityController.ts': 'export class EquityController {}',
      'data/secrets.txt': 'This file contains a SECRET-CANARY-MARKER for testing.\n',
    });
    track(ws);
    const ruleSet = mergeLegacyRules(
      buildRuleSet({
        path: ['EquityController.ts'],
        content: [{ id: 'controller', pattern: /EquityController/, recovery: 'Delete the controller file.' }],
        canary: [{ id: 'canary-secret', pattern: /SECRET-CANARY-MARKER/, recovery: 'Scrub the canary.' }],
      }, 'demo'),
      [],
    );
    const findings = scanWorkspace(ws, ruleSet);
    const sources = findings.map(f => f.source).sort();
    assert.ok(sources.includes('path'));
    assert.ok(sources.includes('content'));
    assert.ok(sources.includes('canary'));
    const controllerFinding = findings.find(f => f.rule_id === 'controller');
    assert.ok(controllerFinding, 'controller rule should fire');
    assert.equal(controllerFinding.recovery, 'Delete the controller file.');
    assert.ok(typeof controllerFinding.line === 'number' && controllerFinding.line >= 1);
    assert.ok(controllerFinding.snippet && controllerFinding.snippet.length > 0);
  }],

  ['scanWorkspace skips oversized files but still scans names', () => {
    const big = 'x'.repeat(1024 * 1024 + 10);
    const ws = makeWorkspace({ 'big/EquityController.ts': big });
    track(ws);
    const ruleSet = { path: [normalizeRule(/EquityController\.ts/)], content: [normalizeRule(/EquityController/)], canary: [] };
    const findings = scanWorkspace(ws, ruleSet, { maxContentBytes: 1024 });
    // Path finding still fires on the name; content finding must not.
    assert.ok(findings.some(f => f.source === 'path'));
    assert.equal(findings.some(f => f.source === 'content'), false);
  }],

  ['computeFixtureDigest is order-stable', () => {
    const a = [{ file: 'a', bytes: 1, sha256: 'aa' }, { file: 'b', bytes: 2, sha256: 'bb' }];
    const b = [{ file: 'b', bytes: 2, sha256: 'bb' }, { file: 'a', bytes: 1, sha256: 'aa' }];
    assert.equal(computeFixtureDigest(a), computeFixtureDigest(b));
  }],

  ['serialiseManifest produces canonical JSON with stable keys', () => {
    const manifest = {
      manifest_version: MANIFEST_VERSION,
      case_id: 'demo',
      source_descriptor: 'demo',
      source_type: 'synthetic',
      provenance: [{ kind: 'generated', label: 'demo' }],
      leakage: { rule_set_digest: '0'.repeat(64), finding_counts: { path: 0, content: 0, canary: 0 } },
      baseline: { status: 'passed', steps: [], started_at: 't', ended_at: 't', duration_ms: 0 },
      files: [{ file: 'README.md', bytes: 1, sha256: '0'.repeat(64) }],
      export: {
        fixture_root: '/tmp/x',
        fixture_digest: '0'.repeat(64),
        status: 'verified',
        produced_at: 't',
        builder_version: BUILDER_VERSION,
        environment: { node: 'v', platform: 'darwin', arch: 'arm64' },
      },
      notes: [],
    };
    const serialised = serialiseManifest(manifest);
    const parsed = JSON.parse(serialised);
    assert.equal(parsed.manifest_version, MANIFEST_VERSION);
    assert.deepEqual(parsed.leakage.finding_counts, { path: 0, content: 0, canary: 0 });
    assert.equal(validateManifest(parsed).length, 0);
  }],

  ['validateManifest rejects malformed digests and unsupported enums', () => {
    const issues = validateManifest({
      manifest_version: MANIFEST_VERSION,
      case_id: 'demo',
      source_type: 'synthetic',
      provenance: [],
      leakage: { rule_set_digest: 'bad', finding_counts: {} },
      baseline: { status: 'passed', steps: [] },
      files: [{ file: 'a', bytes: 0, sha256: 'not-a-hash' }],
      export: { fixture_root: '/x', fixture_digest: 'bad', status: 'wat' },
    });
    const paths = issues.map(i => i.path);
    assert.ok(paths.includes('$.leakage.rule_set_digest'));
    assert.ok(paths.includes('$.export.fixture_digest'));
    assert.ok(paths.includes('$.export.status'));
    assert.ok(paths.includes('$.files[0].sha256'));
  }],

  ['resolveBaselineSteps accepts map and array shapes', () => {
    const fromMap = resolveBaselineSteps({
      build: { command: ['npm', 'run', 'build'] },
      test: ['npm', 'test'],
      lint: { command: ['npm', 'run', 'lint'], required: false },
    });
    assert.deepEqual(fromMap.map(s => s.type), ['build', 'test', 'lint']);
    assert.equal(fromMap[2].required, false);
    const fromArray = resolveBaselineSteps([{ type: 'build', command: ['echo', 'ok'] }]);
    assert.equal(fromArray.length, 1);
  }],

  ['runBaselineGate reports failures and stops at the first required miss', () => {
    const ws = makeWorkspace();
    track(ws);
    const logs = mkdtempSync(join(tmpdir(), 'vab-gate-logs-'));
    track(logs);
    const gate = runBaselineGate({
      workspaceRoot: ws,
      logsRoot: logs,
      steps: [
        { type: 'build', command: ['false'], required: true },
        { type: 'test', command: ['true'], required: true },
      ],
    });
    assert.equal(gate.status, 'failed');
    assert.equal(gate.steps.length, 1); // stopped at first failure
    assert.equal(gate.steps[0].status, 'failed');
    assert.ok(existsSync(join(logs, 'build.log.json')));
  }],
];

// ----- lifecycle tests ------------------------------------------------------

checks.push(
  ['buildFixture exports a verified fixture with a manifest and stable digest', () => {
    const source = makeWorkspace();
    track(source);
    const exportRoot = mkdtempSync(join(tmpdir(), 'vab-export-'));
    track(exportRoot);
    const result = buildFixture({
      case_id: 'demo',
      source_root: source,
      export_root: exportRoot,
      leakage: { content: ['NONEXISTENT_PATTERN'] },
      provenance: [{ kind: 'generated', label: 'demo generator' }],
      baseline: {}, // no declared steps → gate skipped, manifest still published
    });
    assert.equal(result.status, 'success', JSON.stringify(result, null, 2));
    assert.ok(existsSync(join(exportRoot, '.fixture', 'manifest.json')));
    assert.ok(existsSync(join(exportRoot, '.fixture', 'EXPORTED')));
    const manifest = JSON.parse(readFileSyncCompat(join(exportRoot, '.fixture', 'manifest.json')));
    assert.equal(manifest.export.status, 'verified');
    assert.match(manifest.export.fixture_digest, /^[0-9a-f]{64}$/);

    // Re-build from the same source and confirm the digest is stable.
    const exportRoot2 = mkdtempSync(join(tmpdir(), 'vab-export-'));
    track(exportRoot2);
    const result2 = buildFixture({
      case_id: 'demo',
      source_root: source,
      export_root: exportRoot2,
      leakage: { content: ['NONEXISTENT_PATTERN'] },
      provenance: [{ kind: 'generated', label: 'demo generator' }],
      baseline: {},
    });
    const manifest2 = JSON.parse(readFileSyncCompat(join(exportRoot2, '.fixture', 'manifest.json')));
    assert.equal(manifest.export.fixture_digest, manifest2.export.fixture_digest);
  }],

  ['buildFixture refuses to publish when an answer pattern leaks', () => {
    const source = makeWorkspace({
      'src/EquityRelationshipController.ts': 'export class EquityRelationshipController {}',
    });
    track(source);
    const exportRoot = mkdtempSync(join(tmpdir(), 'vab-export-'));
    track(exportRoot);
    const result = buildFixture({
      case_id: 'narrative-equity-relationship',
      source_root: source,
      export_root: exportRoot,
      provenance: [{ kind: 'generated', label: 'demo' }],
      baseline: {},
    });
    assert.equal(result.status, 'error', JSON.stringify(result, null, 2));
    assert.ok(result.leakage_findings.length >= 1);
    assert.ok(result.leakage_finding_counts.content >= 1);
    assert.equal(existsSync(join(exportRoot, '.fixture', 'manifest.json')), false);
    assert.equal(existsSync(join(exportRoot, '.fixture', 'EXPORTED')), false);
  }],

  ['buildFixture refuses to publish when a declared baseline fails', () => {
    const source = makeWorkspace();
    track(source);
    const exportRoot = mkdtempSync(join(tmpdir(), 'vab-export-'));
    track(exportRoot);
    const result = buildFixture({
      case_id: 'demo',
      source_root: source,
      export_root: exportRoot,
      provenance: [{ kind: 'generated', label: 'demo' }],
      baseline: { build: { command: ['false'], required: true } },
    });
    assert.equal(result.status, 'error', JSON.stringify(result, null, 2));
    assert.equal(result.baseline.status, 'failed');
    assert.equal(existsSync(join(exportRoot, '.fixture', 'manifest.json')), false);
  }],

  ['buildFixture passes when an optional (non-required) baseline fails', () => {
    const source = makeWorkspace();
    track(source);
    const exportRoot = mkdtempSync(join(tmpdir(), 'vab-export-'));
    track(exportRoot);
    const result = buildFixture({
      case_id: 'demo',
      source_root: source,
      export_root: exportRoot,
      provenance: [{ kind: 'generated', label: 'demo' }],
      baseline: {
        build: { command: ['true'], required: true },
        lint: { command: ['false'], required: false },
      },
    });
    assert.equal(result.status, 'warning', JSON.stringify(result, null, 2));
    assert.ok(existsSync(join(exportRoot, '.fixture', 'manifest.json')));
  }],

  ['buildFixture applies compile-clean patches that remove answer references', () => {
    const source = makeWorkspace({
      'src/registry.ts': 'import { EquityController } from "./EquityController";\nregistry.register(EquityController);\n',
      'src/EquityController.ts': 'export class EquityController {}',
    });
    track(source);
    const exportRoot = mkdtempSync(join(tmpdir(), 'vab-export-'));
    track(exportRoot);
    const result = buildFixture({
      case_id: 'narrative-equity-relationship',
      source_root: source,
      export_root: exportRoot,
      leakage: { content: ['EquityController'] },
      patches: [
        { path: 'src/EquityController.ts', apply: 'delete' },
        {
          path: 'src/registry.ts',
          apply: 'replace',
          old: 'import { EquityController } from "./EquityController";\nregistry.register(EquityController);\n',
          new: '// registry: answer module removed during sanitisation\n',
        },
      ],
      provenance: [{ kind: 'repository', label: 'sanitised snapshot', modified: true }],
      baseline: {},
    });
    assert.equal(result.status, 'success', JSON.stringify(result, null, 2));
    assert.ok(!existsSync(join(exportRoot, 'src', 'EquityController.ts')));
    const patched = readFileSyncCompat(join(exportRoot, 'src', 'registry.ts'));
    assert.ok(!patched.includes('EquityController'));
  }],

  ['buildFixture records canary findings without blocking publication', () => {
    const source = makeWorkspace({ 'data/note.md': 'CANARY-DEMO-MARKER text\n' });
    track(source);
    const exportRoot = mkdtempSync(join(tmpdir(), 'vab-export-'));
    track(exportRoot);
    const result = buildFixture({
      case_id: 'demo',
      source_root: source,
      export_root: exportRoot,
      canary_names: ['CANARY-DEMO-MARKER'],
      provenance: [{ kind: 'generated', label: 'demo' }],
      baseline: {},
    });
    assert.equal(result.status, 'warning', JSON.stringify(result, null, 2));
    assert.equal(result.leakage_finding_counts.canary, 1);
    assert.equal(result.leakage_finding_counts.content, 0);
    assert.ok(existsSync(join(exportRoot, '.fixture', 'manifest.json')));
  }],

  ['scanForAnswerLeakage (file-isolation facade) stays backward compatible and supports detailed mode', () => {
    const ws = makeWorkspace({ 'src/EquityRelationshipController.ts': 'export class EquityRelationshipController {}' });
    track(ws);
    const legacy = scanForAnswerLeakage('narrative-equity-relationship', ws);
    assert.ok(legacy.length >= 1, `Expected findings, got ${legacy.length}`);
    assert.ok(legacy.every(f => typeof f.rule !== 'undefined'));
    const detailed = scanForAnswerLeakage('narrative-equity-relationship', ws, { detailed: true });
    assert.ok(detailed.some(f => f.rule_id && f.recovery));
  }],

  ['copyWorkspaceWithExclusion strips declared groups during copy', () => {
    const source = makeWorkspace({
      '.git/HEAD': 'ref: refs/heads/main',
      'node_modules/x/index.js': 'module.exports = 1;',
      'src/index.ts': 'export const x = 1;',
    });
    track(source);
    const target = mkdtempSync(join(tmpdir(), 'vab-copy-'));
    track(target);
    copyWorkspaceWithExclusion(source, target, { groups: { docs: ['README.md'] } });
    const files = listFiles(target).map(f => f.path);
    assert.equal(files.includes('.git/HEAD'), false);
    assert.equal(files.includes('node_modules/x/index.js'), false);
    assert.equal(files.includes('README.md'), false);
    assert.ok(files.includes('src/index.ts'));
  }],
);

// ----- runner ---------------------------------------------------------------

function readFileSyncCompat(path) {
  return readFileSync(path, 'utf8');
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
cleanupAll();

const result = {
  status: failures.length ? 'error' : 'success',
  summary: `${checks.length - failures.length}/${checks.length} fixture checks passed.`,
  next_actions: failures.length ? ['Fix failed fixture checks.'] : [],
  artifacts: ['tests/fixtures/run.mjs'],
  ...(failures.length ? { failures } : {}),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
