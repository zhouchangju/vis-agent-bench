# VAB-T15 Evidence

- Status: DONE
- Baseline: `ac618d3` (`chore: add security hardening gates`)
- Branch: `codex/vab-t15-browser-hardening`
- Changed paths:
  - `src/browser-evidence/drivers/index.mjs`
  - `src/browser-evidence/drivers/playwright-driver.mjs`
  - `src/browser-evidence/drivers/playwright-policy.mjs`
  - `src/browser-evidence/drivers/playwright-spec.mjs`
  - `scripts/capture-playwright-evidence.mjs`
  - `tests/browser-evidence/playwright/fixtures/index.html`
  - `tests/browser-evidence/playwright/run.mjs`
  - `tests/browser-evidence/playwright/success.smoke.json`
  - `docs/architecture/BROWSER_EVIDENCE_PROTOCOL.md`
  - this evidence file
- Acceptance commands and results:
  - `node tests/browser-evidence/playwright/run.mjs` → PASS, 10/10 checks using real
    Playwright Chromium. The suite preserves T11 happy, intentional product failure, navigation
    failure, and environment failure classification.
  - Adversarial policy checks → PASS: the platform hosts file (`/etc/hosts` on this run), a
    fixture-root symlink resolving to that file, an undeclared loopback origin, and a
    same-port/different-hostname subresource were all denied.
  - Bounds checks → PASS: `timeout_ms=0` and `default_timeout_ms=0` were rejected; 65 steps were
    rejected against the 64-step maximum.
  - Total capture deadline → PASS in real Chromium: a 5-second capture deadline interrupted a
    5-second post-navigation wait, force-closed browser resources, returned in under 8 seconds, and
    emitted `CAPTURE_INCOMPLETE` with `failure_class=product` and `deadline_exceeded=true`.
  - Browser boundary checks → PASS: Service Worker script requests and server WebSocket upgrades
    both remained zero; the manifest recorded the intercepted WebSocket policy event.
  - Screenshot/final URL checks → PASS: the full-page PNG IHDR was independently read by the test
    and exactly matched manifest dimensions; its height exceeded the viewport, and `page_url`
    reflected the final `/final` navigation.
  - `node tests/browser-evidence/run.mjs` → PASS, 26/26 VAB-T06 regression checks.
  - CLI default-deny check with no `--allow-origin` → expected exit 1 and structured
    `POLICY_DENIED`; no browser was launched.
  - Initial `npm test` → expected environment setup failure because this fresh worktree lacked the
    repository's existing `yaml` package.
  - `npm ci --ignore-scripts` → installed the existing locked dependency without changing
    `package.json` or `package-lock.json`.
  - `npm test` → PASS: contracts 8/8, evaluator core 42/42, fixtures 23/23, repository structure,
    and syntax checks.
  - `git diff --check` → PASS in the final combined verification gate.
- Produced artifacts:
  - Hardened, default-deny control-plane policy API with exact loopback origins and realpath-based
    fixture roots.
  - Stable happy manifest and real full-page PNG under
    `/tmp/vis-agent-bench-vab-t11/success/`.
  - Stable intentional product-failure evidence under
    `/tmp/vis-agent-bench-vab-t11/failure/`.
  - Stable deadline evidence under `/tmp/vis-agent-bench-vab-t11/deadline/`.
  - CLI policy flags `--allow-origin` and `--allow-file-root`; neither is accepted from the
    model-visible smoke spec.
- Not proven:
  - These are application-level URL and browser-API controls, not OS-level sandboxing. A separate
    least-privilege worktree/container boundary remains required for hostile code.
  - Windows and Linux execution were not run in this worktree. The adversarial test selects the
    platform hosts file, but Windows symlink creation may depend on host privileges.
  - Cross-browser behavior, aesthetics, complete visual correctness, accessibility, performance,
    pixel-baseline equivalence, animation quality, and WebGL correctness are not proven.
  - The runtime still comes from the local Playwright npm cache and browser cache; a clean machine
    without them returns the existing structured environment failure until integration pins the
    dependency.
- Remaining risks:
  - A process with independent filesystem or network authority can bypass this in-browser policy;
    it must not be treated as a replacement for benchmark process isolation.
  - Exact-origin policy intentionally requires the controller to enumerate every fixture origin.
    Multi-origin fixtures need an explicit reviewed policy and will fail closed if it is incomplete.
- Integration notes:
  - Callers must pass `capture(spec, { policy: { allowed_origins, allowed_file_roots } })`.
    Omitting policy grants no file roots and no origins.
  - Existing T11 specs remain declarative; `capture_deadline_ms` is optional and defaults to 60000.
  - No `package.json`, lockfile, task catalog, public T06 contract, or Case file was modified.
- Rollback:
  - Revert the single VAB-T15 task commit. All changes are confined to VAB-T15 allowed paths.
