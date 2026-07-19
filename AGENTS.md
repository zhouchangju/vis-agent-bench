# Repository Guidelines

## Purpose

`vis-agent-bench` is a reproducible benchmark and harness for visualization coding agents.
It measures complete task delivery, not isolated model prose quality.

## Source Of Truth

- Product intent: `docs/product/PRD.md`
- Architecture: `docs/architecture/ARCHITECTURE.md`
- Requirement granularity: `docs/design/REQUIREMENT_GRANULARITY.md`
- Candidate selection: `docs/candidates/`
- Approved benchmark cases: `cases/`
- Executable behavior: `src/`, `scripts/`, `package.json`

## Case Governance

- Candidate ideas stay in `docs/candidates/`.
- Only user-approved candidates become directories under `cases/`.
- Every formal Case must separate:
  - model-visible requirement;
  - evaluator-visible acceptance contract;
  - fixture provenance;
  - run budget and stop conditions.
- Do not leak hidden assertions into the model-visible prompt.
- Mark inferred or proposed requirements as such; do not present them as historical facts.

## Security

- Never commit credentials, cookies, access tokens, private environment files, or raw secrets.
- Do not commit unredacted internal screenshots containing names, email addresses, project IDs, or internal URLs.
- Local source repositories may be referenced as provenance, but internal source snapshots require an explicit sanitization decision.
- Runs must eventually execute in isolated worktrees or containers, never directly in a user's source repository.

## Editing And Verification

- Use `npm test` after structural documentation changes.
- Keep scripts deterministic and return structured output with:
  - `status`
  - `summary`
  - `next_actions`
  - `artifacts`
- Prefer narrow Runner and Evaluator adapters over catch-all execution tools.

