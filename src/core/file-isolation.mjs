import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const excludedNames = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
]);

const leakageRules = {
  'macro-map-3d-greenfield': [
    /GraphScene\.tsx/i,
    /scene\/managers\/(?:Animation|Color|Edge|Interaction|Layout|Node)Manager/i,
  ],
  'standard-chart-two-way-tree': [
    /dvTwoWayTree/i,
    /TwoWayTreeView/i,
    /twoWayTree\.js/i,
    /自定义双向树图组件扩展/i,
  ],
  'narrative-equity-relationship': [
    /EquityRelationship(?:Controller|View|Data|State|Layout|Interaction|Config)?/i,
    /ChapterTransitionCoordinator/i,
    /ChapterEntryBaseline/i,
    /NodeLayoutResolver/i,
    /AnimationEngine/i,
    /packages[\\/]+equity-relationship/i,
    /@narrative-visual\/equity-relationship/i,
    /股权关系可视化组件/i,
  ],
  'ainvest-market-heatmap-rebuild': [
    /WidgetHeatmap/i,
    /HeatmapTreemapView/i,
    /useTreemapChart/i,
    /widget-heatmap/i,
  ],
};

function shouldCopy(source) {
  return !excludedNames.has(basename(source));
}

export function copyWorkspaceSource(source, target) {
  if (!existsSync(source)) throw new Error(`Workspace source does not exist: ${source}`);
  cpSync(source, target, {
    recursive: true,
    filter: shouldCopy,
    preserveTimestamps: true,
  });
}

export function listFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const stat = statSync(path);
        const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        files.push({ path: relative(root, path), bytes: stat.size, sha256: hash });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function scanForAnswerLeakage(caseId, workspace) {
  const rules = leakageRules[caseId] || [];
  const findings = [];
  const files = listFiles(workspace);

  for (const file of files) {
    for (const rule of rules) {
      if (rule.test(file.path)) findings.push({ file: file.path, rule: String(rule), source: 'path' });
    }
    if (file.bytes > 1024 * 1024) continue;
    const absolute = join(workspace, file.path);
    let text;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.test(text)) findings.push({ file: file.path, rule: String(rule), source: 'content' });
    }
  }

  return findings;
}

export function createRunLayout(projectRoot, runId) {
  const runDir = resolve(projectRoot, '.local', 'runs', runId);
  for (const part of ['input', 'workspace', 'logs', 'artifacts', 'review', '.empty-skills']) {
    mkdirSync(join(runDir, part), { recursive: true });
  }
  writeFileSync(
    join(runDir, 'ISOLATION.md'),
    [
      '# File-isolated development run',
      '',
      'This run uses a clean directory and answer-leakage scan.',
      'It does not provide OS-level read isolation and is not leaderboard eligible.',
      '',
    ].join('\n'),
  );
  return runDir;
}
