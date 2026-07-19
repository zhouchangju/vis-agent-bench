# Report archive

Generated leadership reports live here after `scripts/generate-report.mjs` has been run against real Run directories. The directory is excluded from automatic regeneration (see `.gitignore`: `reports/generated/`).

## What goes here

- **Manually curated reference reports** that captured a real decision moment (e.g., a model evaluation round, a gate review).
- **Named subdirectories** (e.g., `2026-07-kimi-vs-baseline/`) so multiple evaluation rounds can coexist.
- **At most one summary file per round** that leadership can open directly.

## What does NOT go here

- Auto-generated reports from the CLI (those land in `reports/generated/` and are git-ignored).
- Raw Run directories, evaluator output, or human-review JSON — those stay in `.local/runs/`.

## Sample reports

The `sample/` subdirectory contains a machine-generated JSON report from the VAB-T07 test fixtures. It carries the explicit `demo: true` marker and must never be mixed with real leaderboard data.

## Adding a real report

1. Complete the machine evidence and human review for one or more runs.
2. Run `node scripts/generate-report.mjs --run <dir> ... --out-dir docs/reports/<round-id>`.
3. Review the generated JSON/Markdown/HTML for correctness.
4. Commit the curated report and link it from a decision record in `docs/decisions/`.

## Schema

All reports in this directory should conform to `schemas/report.schema.json`. Validate with `node src/reporting/validate.mjs` (or `npm test` once wired).
