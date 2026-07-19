// Shared DEMO fixtures for the reporting tests.
//
// Every value below is hand-authored for deterministic behaviour. The fixtures
// intentionally cover:
//   - a fully reviewed accepted run with reported cost/tokens;
//   - a reviewed-but-partial run with no evaluator;
//   - an unreviewed run that lacks human_review entirely;
//   - a CLI failure run (status=error) with evaluator P0 failed;
//   - a baseline-only object with no run/evaluator/review.
//
// DEMO markers are set explicitly so the resulting reports can never be
// confused with real leaderboard data.

export function buildAcceptedEntry({ runId = 'demo-accepted-001', caseId = 'macro-map-3d-greenfield', model = 'kimi/k3-coder', demo = true } = {}) {
  return {
    demo,
    run: {
      run_id: runId,
      case_id: caseId,
      status: 'success',
      duration_ms: 3600_000,
      engine: { provider: 'kimi', configured_model: model.split('/')[1] || model },
      usage: { input_tokens: 1200, output_tokens: 800, cached_tokens: 0, cost_usd: 0.12, availability: 'reported' },
    },
    evaluator: { summary: { p0_passed: true, score: 78, p0_min_score: 70 } },
    isolation: { leaderboard_eligible: false },
    human_review: {
      schema_version: 2,
      run_id: runId,
      reviewer: 'demo-reviewer',
      isolation: 'file-isolated-development',
      reviewed_at: '2026-07-19T10:00:00Z',
      reviews: [
        {
          case_id: caseId,
          complete: true,
          decision: 'accepted-with-fixes',
          scores: { business: 4, visual: 3, interaction: 4, usability: 4 },
          human_time: {
            clarification_minutes: 90,
            context_prep_minutes: 70,
            poc_review_minutes: 35,
            micro_adjustment_minutes: 120,
            fix_minutes: 55,
            final_review_minutes: 30,
          },
          convergence: {
            clarification_rounds: 2,
            iterations_to_acceptance: 4,
            micro_adjustment_items: 5,
            must_have_misses: 1,
            requirement_regressions: 0,
            first_poc_fitness_percent: 71,
          },
          observations: {
            strengths: 'Layout and base interaction landed cleanly.',
            problems: 'Relationship hit-rate and mobile degradation need rework.',
            required_fixes: 'Add regression tests for relationship lookup.',
            management_judgment: 'High-value assist for first-version; humans still drive convergence.',
          },
        },
      ],
    },
  };
}

export function buildPartialEntry({ runId = 'demo-partial-001', caseId = 'macro-map-3d-greenfield', model = 'codex/gpt-5-codex', demo = true } = {}) {
  return {
    demo,
    run: {
      run_id: runId,
      case_id: caseId,
      status: 'success',
      duration_ms: 2700_000,
      engine: { provider: 'codex', configured_model: model.split('/')[1] || model },
      usage: { input_tokens: 900, output_tokens: 600, availability: 'partial' },
    },
    evaluator: { summary: { p0_passed: false, score: 55, p0_min_score: 70 } },
    isolation: { leaderboard_eligible: false },
    human_review: {
      schema_version: 2,
      run_id: runId,
      reviewer: 'demo-reviewer',
      isolation: 'file-isolated-development',
      reviewed_at: '2026-07-19T11:00:00Z',
      reviews: [
        {
          case_id: caseId,
          complete: false,
          decision: 'partial',
          scores: { business: 3, visual: 3, interaction: 2, usability: 3 },
          human_time: {
            clarification_minutes: 110,
            context_prep_minutes: 60,
            poc_review_minutes: 40,
            micro_adjustment_minutes: 140,
            fix_minutes: 90,
            final_review_minutes: 25,
          },
          convergence: {
            clarification_rounds: 3,
            iterations_to_acceptance: 6,
            micro_adjustment_items: 9,
            must_have_misses: 3,
            requirement_regressions: 2,
            first_poc_fitness_percent: 52,
          },
          observations: {
            strengths: 'Base graph rendering and stage switching landed.',
            problems: 'Layout breaks on dense data; animation continuity fails.',
            required_fixes: 'Rework dense layout; align audio with chapter transitions.',
            management_judgment: 'Limited assist; rework cost approaches baseline.',
          },
        },
      ],
    },
  };
}

export function buildUnreviewedEntry({ runId = 'demo-unreviewed-001', caseId = 'ainvest-market-heatmap-rebuild', model = 'claude/sonnet-4.5', demo = true } = {}) {
  return {
    demo,
    run: {
      run_id: runId,
      case_id: caseId,
      status: 'success',
      duration_ms: 1800_000,
      engine: { provider: 'claude', configured_model: model.split('/')[1] || model },
      // Kimi-style: no usage event at all.
    },
    evaluator: { summary: { p0_passed: true, score: 80, p0_min_score: 70 } },
    isolation: { leaderboard_eligible: false },
  };
}

export function buildFailedEntry({ runId = 'demo-failed-001', caseId = 'narrative-equity-relationship', model = 'kimi/k3-coder', demo = true } = {}) {
  return {
    demo,
    run: {
      run_id: runId,
      case_id: caseId,
      status: 'error',
      duration_ms: 600_000,
      engine: { provider: 'kimi', configured_model: model.split('/')[1] || model },
      error: { root_cause_hint: 'CLI exited non-zero during stage S2.' },
    },
    evaluator: {
      summary: { p0_passed: false, score: 30, p0_min_score: 70 },
      failures: [{ message: 'Build failed: missing requirement-ledger.yaml' }],
    },
    isolation: { leaderboard_eligible: false },
  };
}

export function buildBaseline({ totalMinutes = 440 } = {}) {
  return { total_minutes: totalMinutes, source: 'human-only-baseline-demo', note: 'DEMO baseline; do not mix with real measurements.' };
}
