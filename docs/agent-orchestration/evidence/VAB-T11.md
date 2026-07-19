# VAB-T11 Evidence

- Status: DONE
- Baseline: `01c0137` (`chore: accept T03 and plan remaining benchmark work`)
- Branch: `codex/vab-t11-playwright-driver`
- Changed paths:
  - `src/browser-evidence/drivers/index.mjs`
  - `src/browser-evidence/drivers/playwright-driver.mjs`
  - `src/browser-evidence/drivers/playwright-loader.mjs`
  - `src/browser-evidence/drivers/playwright-spec.mjs`
  - `scripts/capture-playwright-evidence.mjs`
  - `tests/browser-evidence/playwright/fixtures/index.html`
  - `tests/browser-evidence/playwright/success.smoke.json`
  - `tests/browser-evidence/playwright/failure.smoke.json`
  - `tests/browser-evidence/playwright/run.mjs`
  - `docs/architecture/BROWSER_EVIDENCE_PROTOCOL.md`
  - this evidence file
- Acceptance commands and results:
  - `node tests/browser-evidence/playwright/run.mjs` → PASS, 5/5 checks using real
    Playwright Chromium `149.0.7827.55`.
  - Happy local page → `success`; click, hover, keyboard, resize, text/visibility assertions,
    screenshot, DOM state, console log, and non-empty Canvas signature captured.
  - Intentional local page failure → `warning`; `SELECTOR_MISSING`, `ASSERT_FAILED`, `PAGE_ERROR`,
    and `NETWORK_FAILURE` all classified as `failure_class=product`, with a post-failure screenshot
    and state manifest.
  - Unreachable loopback page → `error`; `LOAD_FAILED` classified as
    `failure_class=navigation`.
  - Injected missing browser runtime → `error`; `DRIVER_UNAVAILABLE` classified as
    `failure_class=environment`, with no product actions evaluated.
  - `node scripts/capture-playwright-evidence.mjs
    tests/browser-evidence/playwright/success.smoke.json --out-dir
    /tmp/vis-agent-bench-vab-t11-cli/success` → PASS, `success`.
  - `node scripts/capture-playwright-evidence.mjs
    tests/browser-evidence/playwright/failure.smoke.json --out-dir
    /tmp/vis-agent-bench-vab-t11-cli/failure` → PASS, expected `warning`.
  - `node tests/browser-evidence/run.mjs` → PASS, 26/26 T06 regression checks.
  - `npm ci --ignore-scripts` → installed the repository's existing `yaml` dependency without
    changing `package.json` or `package-lock.json`.
  - `npm test` → PASS: contracts 8/8, evaluator core 42/42, fixtures 23/23, and structure validation.
  - `git diff --check` → PASS.
- Produced artifacts:
  - Stable successful evidence manifest:
    `/tmp/vis-agent-bench-vab-t11/success/browser-evidence.json`.
  - Stable successful real PNG:
    `/tmp/vis-agent-bench-vab-t11/success/final.png`.
  - Stable intentional-failure manifest:
    `/tmp/vis-agent-bench-vab-t11/failure/browser-evidence.json`.
  - Stable intentional-failure PNG:
    `/tmp/vis-agent-bench-vab-t11/failure/failure.png`.
  - Equivalent CLI artifacts under `/tmp/vis-agent-bench-vab-t11-cli/{success,failure}`.
  - Real-browser manifest remains compatible with the VAB-T06 schema version 1 validator and
    structured error codes, adding `failure_class`, `console_messages`, and runtime metadata.
- Not proven:
  - Aesthetics, visual taste, narrative quality, complete visual correctness, and human acceptance
    are not automated claims; the PNGs and manifest still require human review.
  - No pixel-baseline or screenshot-similarity assertion is implemented.
  - Cross-browser behavior, responsive coverage beyond the declared resize, accessibility,
    animation quality, performance, and long-running stability are not proven.
  - Canvas PNG signatures prove observable, non-empty bytes only; chart semantics and WebGL
    correctness are not proven. `canvas_webgl_proven` remains `false`.
  - The local machine supplied Playwright from its npm npx cache and Chromium from the standard
    Playwright browser cache. A clean CI machine without either will return a structured
    `environment/DRIVER_UNAVAILABLE` result until VAB-T08 chooses and installs a dependency.
- Remaining risks:
  - CSS selectors can still be brittle when product markup changes; smoke specs should prefer stable
    user-facing identifiers.
  - Browser-version drift can alter screenshot bytes while the declared behavioral assertions still
    pass. The manifest records the actual browser version.
  - The Driver limits navigation and subresources to loopback/`file:` URLs, but this is an
    application-level restriction, not OS-level isolation.
- Integration notes:
  - VAB-T08 can import `createPlaywrightDriver` from
    `src/browser-evidence/drivers/index.mjs`; no public T06 entrypoint or `package.json` was modified
    because both are outside VAB-T11 allowed paths.
  - VAB-T08 should decide whether to add a pinned Playwright dependency/browser install. Runtime
    discovery already checks a project package before configured/cache/global fallbacks.
  - Consumers should branch on `failure_class` before interpreting T06 codes: environment is harness
    readiness, navigation is page reachability, and product is behavior/runtime evidence.
- Rollback:
  - Revert the single VAB-T11 task commit; all implementation and tests are additive within T11
    allowed paths.
