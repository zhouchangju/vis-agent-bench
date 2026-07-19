# VAB-T14 Evidence

- Task: 真实模型 Pilot 与领导可读证据报告
- Status: `ready_for_acceptance`
- Evidence cutoff: `2026-07-20T00:21:17+08:00`
- Human review: `pending`
- Leaderboard eligible: `false`

## Produced artifacts

- `config/pilots/vab-t14.yaml`
- `runs/pilots/2026-07-19/manifest.json`
- `runs/pilots/2026-07-19/assets/`
- `docs/reports/pilots/2026-07-19-real-model-pilot.md`
- `docs/reports/pilots/2026-07-19-real-model-pilot.html`

## Final evidence inventory

The compact manifest records nine real-model runs:

1. Kimi K3 macro-map controlled pilot: `success`; S0–S4 each completed in one attempt; 9,888,981 ms; Kimi Code 0.27.0; model `kimi-code/k3`; Token and cost unavailable.
2. Codex GPT-5.6 macro-map controlled pilot: S0 provider/model-metadata and transport failure.
3. Codex GPT-5.6-sol macro-map controlled pilot: code-producing attempt stopped by checkpoint identity gate; an earlier resume attempt was affected by a Harness write-permission defect.
4. DeepSeek V4 development smoke through Claude Code: basic smoke path completed; this is not complex visualization delivery.
5. GLM-5.2 narrative-equity run through Claude Code: a resumed invocation completed S3, then S4 stopped by HTTP 429 five-hour usage cap. The latest invocation lasted 1,905,314 ms; overall usage is partial because not every attempt reported usage.
6. GLM-5.2 macro-map run through Claude Code: a resumed invocation completed S3, then S4 stopped by HTTP 429 five-hour usage cap. The latest invocation lasted 1,882,458 ms; reported aggregate usage is 1,467,735 input / 182,486 output / 26,554,240 cached / $25.177945.
7. Codex GPT-5.6-sol narrative-equity legacy smoke: CLI stages exited successfully, while the old symbolic-checkpoint evaluator could not establish delivery acceptance.
8. Unintended DeepSeek default smoke: HTTP 400 model-not-found before useful execution; Token/cost treated as unavailable. This is evidence of a configuration preflight gap.
9. Final-hardened Codex smoke: `success`; S0–S2 each completed; 538,008 ms; 545,598 input / 12,056 output / 453,632 cached; cost unavailable. It ran on `68514fd`; later observational/resume fixes are present through integration HEAD `5774013`.

## Kimi frozen evidence

SHA-256 digests are recorded in the manifest for:

- final `result.json`
- final `run-state.json`
- checkpoints S2, S3 and S4
- model-produced browser-checks for S2, S3 and S4
- `artifacts/workspace.diff`
- five selected Kimi screenshots
- one GLM narrative screenshot and one GLM 3D screenshot

The copied assets are under `runs/pilots/2026-07-19/assets/`.

## Deterministic evaluator gap

After the Kimi CLI run completed, the operator used the latest integration Harness to execute:

`node scripts/bench.mjs evaluate --run-dir .../pilot-kimi-k3-macro-3d-20260719`

The evaluator stopped immediately because `observation-attestation.json` is absent at the run root.

- Kimi checkpoints exist.
- Model-produced S2–S4 `browser-checks.json` files exist.
- A Harness-issued observation attestation does not exist.
- No attestation was fabricated during evidence closure.

Therefore `Harness-attested deterministic evaluator = incomplete`, `human_review_pending`, and `leaderboard_eligible=false`. This is an evidence-chain gap and is not classified as a Kimi model-quality failure.

## Operator preview

Operator preview is retained as informal visual evidence, not formal acceptance:

- 200-node selected state: arrows are oversized and crowded.
- S3 ego view: highly hairball-like.
- 3D panel version: runnable, but hierarchy and visual polish need human adjustment.

The supported conclusion is limited to: Kimi independently completed the S0–S4 CLI/checkpoint stages for a complex POC, and the S4 build/typecheck/test gate passed. Harness-attested deterministic evaluation, business acceptance, and model superiority are not established.

## Required interpretation controls

- The T14 controlled complex runs are reconstructed against commit `65e2b5a`; confidence is `inferred` because the commit was not embedded into their run artifacts.
- Legacy integration complex runs do not preserve an exact Harness commit and used an older symbolic-checkpoint evaluator.
- The final Codex smoke ran on `68514fd`; subsequent fixes through `5774013` are later observations, not retroactive properties of the run.
- File-isolated development workspaces inherit host authentication. Soft file isolation does not guarantee prevention of host reads.
- CLI stage success does not equal Harness deterministic evaluation success.
- Harness evaluation success would still not equal business-side visual acceptance.
- Missing or zero-valued Token/cost fields are not converted into provider billing claims.
- No model winner, business acceptance, or measured productivity gain is claimed.

## Acceptance readiness

T14 evidence packaging is ready for controller acceptance:

- final Kimi facts incorporated
- deterministic evaluator gap disclosed
- final-hardened Codex smoke incorporated
- unintended DeepSeek model-not-found smoke incorporated as a configuration-gap sample
- selected visual assets copied and hashed
- Markdown and self-contained HTML reports updated
- manifest, report and evidence status aligned to `ready_for_acceptance`
