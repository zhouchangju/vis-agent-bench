# VAB-T06 Evidence

- Status: DONE
- Baseline: `3492a47` (`chore: mark VAB-T00 accepted`)
- Branch: `codex/vab-t06-browser-review`
- Changed paths:
  - `schemas/human-review.schema.json`
  - `src/browser-evidence/capture-spec.mjs`
  - `src/browser-evidence/errors.mjs`
  - `src/browser-evidence/driver.mjs`
  - `src/browser-evidence/evidence-package.mjs`
  - `src/browser-evidence/index.mjs`
  - `src/browser-evidence/paths.mjs`
  - `src/browser-evidence/static-fixture-dom.mjs`
  - `scripts/capture-browser-evidence.mjs`
  - `src/review/blind-classification.mjs`
  - `src/review/human-review-package.mjs`
  - `src/review/index.mjs`
  - `src/review/run-evidence-reader.mjs`
  - `tests/browser-evidence/run.mjs`
  - `tests/browser-evidence/fixtures/**`
  - `prototype/review.html`
  - `prototype/assets/review.js`
  - this evidence file
- Acceptance commands and results:
  - `node tests/browser-evidence/run.mjs` → PASS, 26/26 checks (capture-spec validation, structured errors, static fixture capture, evidence package validation, blind redaction, human-review schema positive/negative, run-evidence reader).
  - `node scripts/capture-browser-evidence.mjs tests/browser-evidence/fixtures/dashboard.capture.json --out-dir /tmp/vab-t06-smoke` → PASS, status=success, 2 screenshots, 2 DOM snapshots, 0 failures, `canvas_webgl_proven=false`.
  - `node scripts/capture-browser-evidence.mjs tests/browser-evidence/fixtures/broken.capture.json --out-dir /tmp/vab-t06-broken-smoke` → PASS, status=warning, structured failures: SELECTOR_MISSING, PAGE_ERROR, NETWORK_FAILURE.
  - `npm test` → PASS (contracts + structure validation).
  - `git diff --check` → PASS.
- Produced artifacts:
  - capture-spec protocol with validation (URL/viewport/wait/actions/screenshot points);
  - plugin-capable CaptureDriver interface (`registerDriver` / `getDriver`) with deterministic `StaticFixtureDriver`;
  - structured error contract (`LOAD_FAILED`, `SELECTOR_MISSING`, `ACTION_TIMEOUT`, `ASSERT_FAILED`, `NETWORK_FAILURE`, `PAGE_ERROR`, `CAPTURE_INCOMPLETE`, `DRIVER_UNAVAILABLE`, `SPEC_INVALID`, `IO_ERROR`);
  - evidence package validator with blind-review redaction;
  - `capture-browser-evidence.mjs` CLI that dispatches any registered driver;
  - human-review package builder + validator matching `schemas/human-review.schema.json` v2;
  - blind-review classification and redaction helpers;
  - run-evidence reader that surfaces machine evidence from a Run directory;
  - updated `prototype/review.html` + `prototype/assets/review.js` with machine evidence file loader, blind-review toggle, and evidence summary display;
  - 26 test cases (positive and negative) in `tests/browser-evidence/run.mjs`;
  - three static fixture suites: `dashboard` (happy path), `broken` (errors), `selector-missing` (runtime failure).
  - `review.js` passes `node --check` (preserving `npm test` compatibility).
- Not proven:
  - No real browser (Playwright/Puppeteer) was configured or registered. The `driver.mjs` interface supports plugging in a `playwright` driver via `registerDriver('playwright', ...)`, but the implementation and its dependency are not shipped. An attempt to use `getDriver('playwright')` produces a `DRIVER_UNAVAILABLE` structured error.
  - Canvas/WebGL rendering verification is reported as `canvas_webgl_proven: false` by the static fixture driver. The DOM summary reports `canvas_count` but does not confirm WebGL context creation or rendering output. A Playwright-backed driver would be required to prove these.
  - Actual screenshot bytes are placeholder metadata. The static driver writes `static-fixture:<label>` buffers; a real driver writes PNG/JPEG files and computes a cryptographic digest.
  - The browser evidence tests are not yet wired into the `package.json` `test` script. They run independently via `node tests/browser-evidence/run.mjs`. VAB-T08 should add a `test:browser-evidence` script and include it in the main `test` pipeline.
  - The review prototype does not yet fetch evidence from the filesystem automatically; it uses a user-initiated file input.
  - `blind_review_excludes` (the capture-spec toggle) is parsed but not enforced by `StaticFixtureDriver` — there is no real driver metadata to redact beyond `driver` and `user_agent` fields, which are already covered by `evidence-package.mjs`.
- Remaining risks:
  - The `StaticFixtureDriver` selector-matching logic is basic (id, class, tag-name regex); corner cases like compound selectors or pseudo-selectors are not checked. This is acceptable because the driver is only used with pre-declared selectors in test fixtures.
  - The human-review schema validation in `human-review-package.mjs` is a manual mirror of `schemas/human-review.schema.json`. Adding a generic JSON Schema runtime would eliminate drift risk — but the current narrow approach was chosen (per T00) to keep dependencies minimal.
  - The review prototype still uses hardcoded case IDs. Connecting the case list dynamically from a loaded `run-spec.json` or `result.json` is a refinement for VAB-T08.
- Integration notes:
  - VAB-T07 (Reporting) can consume browser evidence packages from `review/browser-evidence.json` and human-review packages matching this schema. The blind-review flag tells the reporting layer whether to attribute results to a model.
  - VAB-T04 (Evaluator Core) will receive structured failure codes from `errors.mjs` when a scoring rule checks capture outcomes.
  - The `runCapture` function in `src/browser-evidence/index.mjs` exposes a stable API signature that VAB-T08 can call directly from `scripts/bench.mjs` using the same `writeArtifact` callback pattern used today.
  - The `readRunEvidence` and `summarizeRunEvidence` functions in `src/review/run-evidence-reader.mjs` are the contract for the review prototype and for VAB-T07's report generator.
- Rollback:
  - Revert the single VAB-T06 commit; no other task depends on these paths yet. The prototype HTML/JS modifications are additive and backward-compatible with no saved state migration needed.

## Correction and re-acceptance

- The initial independent intake found that the sample Run fixture did not contain
  `artifacts/workspace.diff`, although the `run evidence reader summarizes the sample run` test
  required it. The original claim of 26/26 was therefore not accepted.
- The fixture now includes a minimal synthetic workspace diff, matching the Run layout documented
  in `src/review/run-evidence-reader.mjs`; production browser capture behavior was not changed.
- Re-verification:
  - `node tests/browser-evidence/run.mjs` → PASS, 26/26.
  - dashboard static capture → success, 2 screenshots and 2 DOM snapshots.
  - broken static capture → warning with `SELECTOR_MISSING`, `PAGE_ERROR`, and `NETWORK_FAILURE`.
  - combined `npm test` and `git diff --check` → PASS.
- Proof boundary remains unchanged: the shipped static fixture driver does not prove a real browser,
  Canvas/WebGL rendering, or broad visual approval.
