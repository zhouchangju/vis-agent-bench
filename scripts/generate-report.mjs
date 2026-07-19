#!/usr/bin/env node
// VAB-T07 report generator CLI.
//
// Reads one or more run directories, builds a structured JSON report that
// conforms to schemas/report.schema.json, validates it, and optionally writes
// JSON / Markdown / HTML to disk. The CLI never executes a model, browser or
// evaluator; it only consumes already-collected evidence on disk.
//
// Usage:
//   node scripts/generate-report.mjs \
//     --run <path-to-run-dir> [--run <path-to-run-dir> ...] \
//     [--baseline <path-to-human-baseline.json>] \
//     [--demo] \
//     [--scope single-run|case-models|model-cases] \
//     [--report-id <id>] \
//     [--out-dir <dir>] \
//     [--format json|markdown|html|all]
//
// Output follows the standard result envelope (status / summary / next_actions
// / artifacts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { buildReport } from '../src/reporting/builders.mjs';
import { loadBaseline, loadEntry } from '../src/reporting/load.mjs';
import { renderHtml, renderMarkdown } from '../src/reporting/render/index.mjs';
import { validateReport } from '../src/reporting/validate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(args) {
  const parsed = { run: [], format: 'all' };
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (!value.startsWith('--')) {
      parsed._ = parsed._ || [];
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2).replaceAll('-', '_');
    const next = args[i + 1];
    if (key === 'run') {
      parsed.run.push(next);
      i += 1;
    } else if (next == null || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function output(status, summary, nextActions = [], artifacts = [], extra = {}) {
  process.stdout.write(`${JSON.stringify({ status, summary, next_actions: nextActions, artifacts, ...extra }, null, 2)}\n`);
}

function fail(message, nextActions) {
  output('error', message, nextActions || [], [], {
    error: { root_cause_hint: message, safe_retry: '修正输入后重新运行。', stop_condition: '连续两次相同失败后停止。' },
  });
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    output('success', '显示帮助。', [], []);
    return;
  }

  if (args.run.length === 0) {
    return fail('至少需要一个 --run <dir>。', [
      '传入一个 --run 生成单次运行报告。',
      '传入同一 Case 的多个 --run 生成模型对比报告。',
      '传入同一模型的多个 --run 生成 Case 覆盖报告。',
    ]);
  }

  for (const runDir of args.run) {
    if (!existsSync(runDir)) return fail(`Run directory not found: ${runDir}`);
  }

  const entries = args.run.map(runDir => loadEntry(resolve(runDir), {
    demo: Boolean(args.demo),
    caseMeta: args.case_title ? { title: args.case_title } : null,
  }));

  let baseline = null;
  if (args.baseline) {
    if (!existsSync(args.baseline)) return fail(`Baseline file not found: ${args.baseline}`);
    baseline = loadBaseline(resolve(args.baseline));
  }

  const reportId = args.report_id || `report-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const generatedAt = new Date().toISOString();

  let report;
  try {
    report = buildReport({
      entries,
      reportId,
      generatedAt,
      scopeHint: args.scope,
      baseline,
      title: args.title,
    });
  } catch (error) {
    return fail(`报告构建失败：${error.message}`, ['检查 --run 输入后重试。']);
  }

  const validation = validateReport(report);
  if (!validation.valid) {
    return fail(
      `报告 Schema 校验失败，共 ${validation.errors.length} 个问题。`,
      validation.result.next_actions,
    );
  }

  const outDir = args.out_dir ? resolve(args.out_dir) : resolve(projectRoot, 'reports', 'generated');
  mkdirSync(outDir, { recursive: true });
  const artifacts = [];
  const formats = args.format === 'all' ? ['json', 'markdown', 'html'] : [args.format];

  if (formats.includes('json')) {
    const path = join(outDir, `${reportId}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    artifacts.push(path);
  }
  if (formats.includes('markdown')) {
    const path = join(outDir, `${reportId}.md`);
    writeFileSync(path, renderMarkdown(report));
    artifacts.push(path);
  }
  if (formats.includes('html')) {
    const path = join(outDir, `${reportId}.html`);
    writeFileSync(path, renderHtml(report));
    artifacts.push(path);
  }

  output(
    'success',
    `已为 ${entries.length} 次运行生成 ${formats.join(', ')} 报告（${report.view.kind}）。`,
    report.recommended_actions.slice(0, 3).map(action => action.title),
    artifacts,
    { report_id: reportId, view: report.view.kind, evidence_completeness: report.evidence_completeness.percent },
  );
}

main().catch(error => {
  fail(`发生未预期错误：${error.message}`, ['减少 --run 输入数量后重试，以定位问题。']);
});
