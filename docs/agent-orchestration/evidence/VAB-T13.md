# VAB-T13 Evidence

- Status: DONE
- Baseline: `13b5e3b` (`chore: accept browser driver and start evaluator wave`)
- Branch: `codex/vab-t13-heatmap-evaluator`
- Changed paths:
  - `src/evaluators/cases/ainvest-heatmap/**`
  - `tests/evaluators/ainvest-heatmap/**`
  - `cases/ainvest-market-heatmap-rebuild/evaluator/acceptance.md`
  - `cases/ainvest-market-heatmap-rebuild/evaluator/rubric.yaml`
  - this evidence file
- Acceptance commands and results:
  - `node tests/evaluators/ainvest-heatmap/run.mjs` → PASS, 6/6 tests.
  - Minimal compliant observation → PASS, 24/24 deterministic checks, score 100.
  - Intentional failure observation → expected FAIL for build, area, color, legend, drill/back,
    search/filter, state restoration, resize, and keyboard accessibility; hard-gate cap applied.
  - `npm test` → PASS: contracts 8/8, evaluator core 42/42, fixtures 23/23, structure and syntax
    validation passed.
  - `git diff --check` → PASS.
  - `node --check` over all new Evaluator modules and the task test → PASS.
- Produced artifacts:
  - Explicit v1 Heatmap rubric with 24 unique check IDs and 8 declared hard gates. Runtime
    assertions, rubric IDs, and tests are guarded as a one-to-one mapping.
  - Deterministic area-share evaluator with a 0.02 normalized-share tolerance, input/rendered
    ordering, group-area aggregation, equal-area behavior, and documented positive null fallback.
  - Deterministic diverging-color evaluator with a 0.001 normalized-position tolerance, shared
    legend domain, clamp behavior, and negative/zero/positive/null/extreme coverage.
  - Behavior/state checks for real-browser runtime errors, tooltip fields, drill/back, instrument
    event, search/filter, loading/empty/error/retry, state restoration, resize preservation, stale
    requests, lifecycle cleanup, responsive viewport facts, keyboard reachability, and deterministic
    high-density label degradation.
  - Minimal-compliant and intentional-failure JSON observations.
  - Acceptance document that explicitly separates machine facts from human visual review.
- Not proven:
  - No candidate implementation was supplied, so this task did not capture a fresh real-browser
    run against a candidate. The included JSON files are Evaluator test doubles; VAB-T08 must feed
    candidate command results and VAB-T11-compatible browser observations into this Evaluator.
  - Screenshots, DOM presence, events, state snapshots, and Canvas signatures do not prove visual
    parity, aesthetics, color taste, typography, Logo quality, or complete Treemap correctness.
  - Safari/cross-browser behavior, pixel-level visual regression, animation quality, subjective
    fluidity, long-running performance, real production market data, and OS-level isolation are not
    proven.
  - Root `package.json` intentionally does not run this Case test because it is outside VAB-T13
    allowed paths; the frozen task test was run directly. VAB-T08 owns integration wiring.
- Remaining risks:
  - The integration adapter must produce the documented structured observation from candidate
    command output and real-browser evidence without trusting candidate-authored pass booleans.
  - Accessibility checks prove declared keyboard traversal/activation observations, not a complete
    WCAG audit or screen-reader quality.
  - The numeric area/color tolerances are deterministic benchmark policy, not a claim that every
    visually acceptable implementation must use identical pixels or color strings.
- Integration notes:
  - Import `evaluateAinvestHeatmap` from
    `src/evaluators/cases/ainvest-heatmap/index.mjs`.
  - Supply either `observation` or `observationPath`; missing top-level observation sections are
    rejected rather than guessed as passing.
  - Preserve the proof boundary in reporting: browser observations prove only declared behavior and
    state. Route screenshots and subjective visual dimensions to human review.
  - `npm ci --ignore-scripts` was needed once because this worktree initially lacked the repository's
    existing `yaml` dependency; no package or lockfile changed.
- Rollback:
  - Revert the single VAB-T13 commit. All changes are confined to VAB-T13 allowed paths.
