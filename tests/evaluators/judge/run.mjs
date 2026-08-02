import assert from 'node:assert/strict';

import {
  buildJudgeReviewPrompt,
  parseJudgeVerdict,
  runJudgeReview,
} from '../../../src/evaluators/judge/judge-model.mjs';

import {
  selectChecksForJudgeReview,
  attachJudgeVerdicts,
  summariseJudgeReviews,
} from '../../../src/evaluators/judge/integration.mjs';

const results = [];
function record(name, error) {
  if (error) {
    results.push({ name, ok: false, message: error.message, stack: error.stack });
    process.stderr.write(`FAIL ${name}: ${error.stack}\n`);
  } else {
    results.push({ name, ok: true });
    process.stdout.write(`PASS ${name}\n`);
  }
}

function check(name, fn) {
  try { fn(); record(name, null); }
  catch (error) { record(name, error); }
}

async function asyncCheck(name, fn) {
  try { await fn(); record(name, null); }
  catch (error) { record(name, error); }
}

// --- 1. buildJudgeReviewPrompt produces a valid prompt with key facts --------

check('buildJudgeReviewPrompt produces a valid prompt with key facts', () => {
  const prompt = buildJudgeReviewPrompt({
    caseId: 'case-001',
    checkId: 'layout-readability',
    scenario: 'Verify that the chart layout is readable on mobile viewport.',
    evaluationResult: { status: 'warning', reason: 'overlapping labels detected' },
    observationSummary: 'Chart rendered with 12 data points; 3 labels overlap at bottom-right.',
    context: 'Rubric note: labels may overlap when data density > 10 points.',
  });

  assert.equal(prompt.role, 'user');
  assert.ok(typeof prompt.content === 'string');
  assert.ok(prompt.content.length > 100, 'prompt is too short');

  // Key facts must appear in the prompt
  assert.ok(prompt.content.includes('case-001'), 'missing caseId');
  assert.ok(prompt.content.includes('layout-readability'), 'missing checkId');
  assert.ok(prompt.content.includes('warning'), 'missing evaluation status');
  assert.ok(prompt.content.includes('overlapping labels'), 'missing reason');
  assert.ok(prompt.content.includes('12 data points'), 'missing observation');
  assert.ok(prompt.content.includes('Rubric note'), 'missing context');

  // Formatting instructions must be present
  assert.ok(prompt.content.includes('<verdict>'), 'missing verdict tag format');
  assert.ok(prompt.content.includes('<confidence>'), 'missing confidence tag format');
  assert.ok(prompt.content.includes('<reasoning>'), 'missing reasoning tag format');
  assert.ok(prompt.content.includes('<suggestion>'), 'missing suggestion tag format');
});

check('buildJudgeReviewPrompt handles missing optional fields gracefully', () => {
  const prompt = buildJudgeReviewPrompt({
    caseId: null,
    checkId: null,
    scenario: null,
    evaluationResult: null,
    observationSummary: null,
    context: null,
  });

  assert.ok(prompt.content.includes('unspecified'), 'should use fallback for null fields');
  assert.ok(prompt.content.includes('no observation provided'));
});

check('buildJudgeReviewPrompt handles object evidence', () => {
  const prompt = buildJudgeReviewPrompt({
    caseId: 'c1', checkId: 'c1', scenario: 'test',
    evaluationResult: {
      status: 'fail',
      reason: 'chart missing',
      evidence: { diffPixels: 1200, threshold: 500 },
    },
    observationSummary: 'chart area is blank',
  });

  assert.ok(prompt.content.includes('diffPixels'), 'should include evidence details');
});

// --- 2. parseJudgeVerdict correctly parses agree/disagree/uncertain ----------

check('parseJudgeVerdict parses agree with confidence and reasoning', () => {
  const response = [
    '<verdict>agree</verdict>',
    '<confidence>0.92</confidence>',
    '<reasoning>The observation clearly matches the evaluation criteria.</reasoning>',
    '<suggestion></suggestion>',
  ].join('\n');

  const verdict = parseJudgeVerdict(response);
  assert.equal(verdict.verdict, 'agree');
  assert.equal(verdict.confidence, 0.92);
  assert.ok(verdict.reasoning.includes('clearly matches'));
  assert.equal(verdict.suggestion, '');
});

check('parseJudgeVerdict parses disagree with suggestion', () => {
  const response = [
    '<verdict>disagree</verdict>',
    '<confidence>0.85</confidence>',
    '<reasoning>The evaluator flagged a false positive.</reasoning>',
    '<suggestion>Re-run with updated thresholds.</suggestion>',
  ].join('\n');

  const verdict = parseJudgeVerdict(response);
  assert.equal(verdict.verdict, 'disagree');
  assert.equal(verdict.confidence, 0.85);
  assert.ok(verdict.suggestion.includes('Re-run'));
});

check('parseJudgeVerdict parses uncertain', () => {
  const response = [
    '<verdict>uncertain</verdict>',
    '<confidence>0.45</confidence>',
    '<reasoning>The evidence is ambiguous.</reasoning>',
    '<suggestion>Human review recommended.</suggestion>',
  ].join('\n');

  const verdict = parseJudgeVerdict(response);
  assert.equal(verdict.verdict, 'uncertain');
  assert.equal(verdict.confidence, 0.45);
});

check('parseJudgeVerdict handles missing tags gracefully', () => {
  const response = 'No structured output, just plain text.';
  const verdict = parseJudgeVerdict(response);
  assert.equal(verdict.verdict, 'uncertain');
  assert.equal(verdict.confidence, 0);
  assert.equal(verdict.reasoning, 'No reasoning provided.');
  assert.equal(verdict.suggestion, '');
});

check('parseJudgeVerdict handles empty string', () => {
  const verdict = parseJudgeVerdict('');
  assert.equal(verdict.verdict, 'uncertain');
  assert.equal(verdict.confidence, 0);
  assert.ok(verdict.reasoning.includes('Empty'));
});

check('parseJudgeVerdict handles unknown verdict text as uncertain', () => {
  const response = [
    '<verdict>maybe</verdict>',
    '<confidence>0.7</confidence>',
    '<reasoning>It might be ok.</reasoning>',
  ].join('\n');
  const verdict = parseJudgeVerdict(response);
  assert.equal(verdict.verdict, 'uncertain');
});

check('parseJudgeVerdict clamps confidence to 0-1 range', () => {
  const tooHigh = parseJudgeVerdict('<verdict>agree</verdict><confidence>1.5</confidence>');
  assert.equal(tooHigh.confidence, 1);

  const tooLow = parseJudgeVerdict('<verdict>agree</verdict><confidence>-0.3</confidence>');
  assert.equal(tooLow.confidence, 0);

  const nonNumeric = parseJudgeVerdict('<verdict>agree</verdict><confidence>abc</confidence>');
  assert.equal(nonNumeric.confidence, 0);
});

check('parseJudgeVerdict handles case-insensitive verdict tags', () => {
  const response = '<VERDICT>AgReE</VERDICT><confidence>0.88</confidence>';
  const verdict = parseJudgeVerdict(response);
  assert.equal(verdict.verdict, 'agree');
  assert.equal(verdict.confidence, 0.88);
});

check('parseJudgeVerdict handles whitespace around tags', () => {
  const response = '  <verdict>  disagree  </verdict>  \n  <confidence>  0.91  </confidence>  ';
  const verdict = parseJudgeVerdict(response);
  assert.equal(verdict.verdict, 'disagree');
  assert.equal(verdict.confidence, 0.91);
});

// --- 3. runJudgeReview mock mode returns a reasonable verdict -----------------

await asyncCheck('runJudgeReview mock mode returns a reasonable verdict for pass status', async () => {
  const review = await runJudgeReview({
    checkId: 'build',
    observation: 'Build output: 0 errors, 0 warnings.',
    evaluationResult: { status: 'pass', reason: 'build succeeded' },
    scenario: 'TypeScript compilation check',
    judgeProvider: 'mock',
  });

  assert.equal(review.status, 'completed');
  assert.equal(review.verdict, 'agree');
  assert.ok(review.confidence > 0.8, 'mock confidence should be high for pass');
  assert.ok(review.reasoning.length > 0);
  assert.equal(review.mock, true);
  assert.ok(review.model.includes('mock'));
});

await asyncCheck('runJudgeReview mock mode returns uncertain for fail status', async () => {
  const review = await runJudgeReview({
    checkId: 'dom-assertion',
    observation: 'DOM element missing; render may have silently failed.',
    evaluationResult: { status: 'fail', reason: 'expected element not found' },
    scenario: 'DOM assertion check',
    judgeProvider: 'mock',
  });

  assert.equal(review.status, 'completed');
  assert.equal(review.verdict, 'uncertain');
  assert.ok(review.confidence > 0.4 && review.confidence < 0.7);
  assert.ok(review.mock, true);
});

await asyncCheck('runJudgeReview mock mode returns disagree for error status', async () => {
  const review = await runJudgeReview({
    checkId: 'flaky-check',
    observation: 'Check timed out after 30s.',
    evaluationResult: { status: 'error', reason: 'harness timeout' },
    scenario: 'Flaky integration check',
    judgeProvider: 'mock',
  });

  assert.equal(review.status, 'completed');
  assert.equal(review.verdict, 'disagree');
  assert.ok(review.suggestion.length > 0, 'should suggest investigation');
  assert.ok(review.mock, true);
});

await asyncCheck('runJudgeReview mock mode uses custom model name', async () => {
  const review = await runJudgeReview({
    checkId: 'check-1',
    evaluationResult: { status: 'pass' },
    scenario: 'test',
    judgeProvider: 'mock',
    judgeModel: 'custom-judge-v1',
  });

  assert.equal(review.model, 'custom-judge-v1');
});

// --- 4. runJudgeReview openai-compatible mode skips without config ------------

await asyncCheck('runJudgeReview openai-compatible mode returns skipped when not configured', async () => {
  const review = await runJudgeReview({
    checkId: 'visual-quality',
    observation: 'screenshot diff: 3% pixel difference',
    evaluationResult: { status: 'warning', reason: 'minor visual discrepancy' },
    scenario: 'Visual quality assessment',
    judgeProvider: 'openai-compatible',
    judgeModel: 'gpt-4o',
  });

  assert.equal(review.status, 'skipped');
  assert.equal(review.reason, 'judge_provider_not_configured');
  assert.equal(review.verdict, 'uncertain');
  assert.equal(review.confidence, 0);
});

// --- 5. selectChecksForJudgeReview -------------------------------------------

check('selectChecksForJudgeReview returns checks with judge_review flag in rubric', () => {
  const rubric = {
    version: 1,
    total: 100,
    hard_gates: ['build'],
    categories: {
      engineering: { weight: 60, checks: ['build', 'layout'] },
      visual: { weight: 40, checks: ['colors', 'readability'] },
    },
    judge_review_checks: ['readability', 'colors'],
    caps: {},
  };

  const evalResults = [
    { check_id: 'build', status: 'pass' },
    { check_id: 'layout', status: 'pass' },
    { check_id: 'colors', status: 'pass' },
    { check_id: 'readability', status: 'pass' },
  ];

  const selected = selectChecksForJudgeReview(rubric, evalResults);

  assert.equal(selected.length, 2);
  const ids = selected.map(s => s.checkId).sort();
  assert.deepEqual(ids, ['colors', 'readability']);
  assert.ok(selected.every(s => s.reason === 'rubric-flagged'));
});

check('selectChecksForJudgeReview returns fail/warn checks without explicit flag', () => {
  const rubric = {
    version: 1,
    total: 100,
    hard_gates: [],
    categories: {
      engineering: { weight: 60, checks: ['build', 'layout'] },
      visual: { weight: 40, checks: ['colors', 'readability'] },
    },
    caps: {},
  };

  const evalResults = [
    { check_id: 'build', status: 'pass' },
    { check_id: 'layout', status: 'fail', reason: 'broken' },
    { check_id: 'colors', status: 'warning', reason: 'minor' },
    { check_id: 'readability', status: 'pass' },
  ];

  const selected = selectChecksForJudgeReview(rubric, evalResults);

  assert.equal(selected.length, 2);
  assert.ok(selected.some(s => s.checkId === 'layout' && s.reason === 'executed-fail'));
  assert.ok(selected.some(s => s.checkId === 'colors' && s.reason === 'executed-warning'));
});

check('selectChecksForJudgeReview does not select skipped or error checks', () => {
  const rubric = {
    version: 1,
    total: 100,
    hard_gates: [],
    categories: { engineering: { weight: 100, checks: ['a', 'b', 'c', 'd'] } },
    caps: {},
  };

  const evalResults = [
    { check_id: 'a', status: 'skipped' },
    { check_id: 'b', status: 'error' },
    { check_id: 'c', status: 'fail' },
    { check_id: 'd', status: 'warning' },
  ];

  const selected = selectChecksForJudgeReview(rubric, evalResults);

  assert.equal(selected.length, 2);
  const ids = selected.map(s => s.checkId).sort();
  assert.deepEqual(ids, ['c', 'd']);
});

check('selectChecksForJudgeReview deduplicates when both flag and status match', () => {
  const rubric = {
    version: 1,
    total: 100,
    hard_gates: [],
    categories: { engineering: { weight: 100, checks: ['layout'] } },
    judge_review_checks: ['layout'],
    caps: {},
  };

  const evalResults = [
    { check_id: 'layout', status: 'fail' },
  ];

  const selected = selectChecksForJudgeReview(rubric, evalResults);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].checkId, 'layout');
  assert.equal(selected[0].reason, 'rubric-flagged');
});

check('selectChecksForJudgeReview uses per-category judge_review_checks', () => {
  const rubric = {
    version: 1,
    total: 100,
    hard_gates: [],
    categories: {
      engineering: {
        weight: 60,
        checks: ['build', 'layout'],
        judge_review_checks: ['layout'],
      },
      visual: { weight: 40, checks: ['colors'] },
    },
    caps: {},
  };

  const evalResults = [
    { check_id: 'build', status: 'fail' },
    { check_id: 'layout', status: 'pass' },
    { check_id: 'colors', status: 'fail' },
  ];

  const selected = selectChecksForJudgeReview(rubric, evalResults);

  // layout is rubric-flagged, colors is executed-fail, build is executed-fail
  assert.equal(selected.length, 3);
  const layoutEntry = selected.find(s => s.checkId === 'layout');
  assert.equal(layoutEntry.reason, 'rubric-flagged');
  const buildEntry = selected.find(s => s.checkId === 'build');
  assert.equal(buildEntry.reason, 'executed-fail');
});

check('selectChecksForJudgeReview handles legacy rubric shape', () => {
  const rubric = {
    weights: { engineering: 60, visual: 40 },
    gates: { p0_min_score: 80, critical_failure_cap: 49 },
    levels: { p0: 'required', p1: 'differentiator', p2: 'production' },
    judge_review_checks: ['layout'],
  };

  const evalResults = [
    { check_id: 'layout', status: 'pass' },
  ];

  const selected = selectChecksForJudgeReview(rubric, evalResults);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].checkId, 'layout');
  assert.equal(selected[0].reason, 'rubric-flagged');
});

check('selectChecksForJudgeReview throws on non-array input', () => {
  assert.throws(
    () => selectChecksForJudgeReview({}, 'not-an-array'),
    TypeError,
  );
});

// --- 6. attachJudgeVerdicts correctly merges verdicts into bundle -------------

check('attachJudgeVerdicts attaches verdicts to matching check results', () => {
  const bundle = {
    schema_version: 1,
    run_id: 'r1',
    case_id: 'c1',
    total: 80,
    status: 'warning',
    results: [
      { check_id: 'build', status: 'pass', reason: 'ok' },
      { check_id: 'layout', status: 'fail', reason: 'broken' },
      { check_id: 'colors', status: 'warning', reason: 'minor' },
    ],
  };

  const judgeReviews = [
    {
      checkId: 'layout',
      verdict: 'disagree',
      confidence: 0.82,
      reasoning: 'Layout is actually fine.',
      suggestion: 'Re-check with updated viewport.',
      status: 'completed',
      model: 'gpt-4o',
      mock: true,
    },
    {
      checkId: 'colors',
      verdict: 'agree',
      confidence: 0.91,
      reasoning: 'Colors do have a minor issue.',
      suggestion: '',
      status: 'completed',
      model: 'gpt-4o',
      mock: true,
    },
  ];

  const updated = attachJudgeVerdicts(bundle, judgeReviews);

  // Original bundle is not mutated
  assert.equal(bundle.results[1].judge_verdict, undefined);

  // Updated bundle has verdicts attached
  const layoutResult = updated.results.find(r => r.check_id === 'layout');
  assert.ok(layoutResult.judge_verdict);
  assert.equal(layoutResult.judge_verdict.verdict, 'disagree');
  assert.equal(layoutResult.judge_verdict.confidence, 0.82);
  assert.equal(layoutResult.judge_verdict.check_id, 'layout');
  assert.equal(layoutResult.judge_verdict.mock, true);
  assert.equal(layoutResult.status, 'fail'); // original status unchanged

  const buildResult = updated.results.find(r => r.check_id === 'build');
  assert.equal(buildResult.judge_verdict, undefined); // no review for this check

  // Judge review summary is present
  assert.ok(updated.judge_review);
  assert.equal(updated.judge_review.total_reviewed, 2);
  assert.equal(updated.judge_review.provider, 'mock');
  assert.equal(updated.judge_review.reviews.length, 2);
});

check('attachJudgeVerdicts handles empty review list', () => {
  const bundle = {
    total: 100,
    status: 'success',
    results: [{ check_id: 'build', status: 'pass' }],
  };

  const updated = attachJudgeVerdicts(bundle, []);

  assert.equal(updated.judge_review.total_reviewed, 0);
  assert.deepEqual(updated.results, bundle.results);
});

check('attachJudgeVerdicts throws on invalid inputs', () => {
  assert.throws(() => attachJudgeVerdicts(null, []), TypeError);
  assert.throws(() => attachJudgeVerdicts({}, 'not-array'), TypeError);
});

check('attachJudgeVerdicts handles review with error status', () => {
  const bundle = {
    total: 100,
    status: 'success',
    results: [{ check_id: 'build', status: 'pass' }],
  };

  const judgeReviews = [{
    checkId: 'build',
    verdict: 'uncertain',
    confidence: 0,
    reasoning: 'Provider error.',
    status: 'error',
    model: null,
  }];

  const updated = attachJudgeVerdicts(bundle, judgeReviews);
  const result = updated.results.find(r => r.check_id === 'build');
  assert.equal(result.judge_verdict.status, 'error');
  assert.equal(result.judge_verdict.verdict, 'uncertain');
});

// --- 7. summariseJudgeReviews -------------------------------------------------

check('summariseJudgeReviews counts verdicts correctly', () => {
  const reviews = [
    { checkId: 'a', verdict: 'agree', status: 'completed' },
    { checkId: 'b', verdict: 'agree', status: 'completed' },
    { checkId: 'c', verdict: 'disagree', status: 'completed' },
    { checkId: 'd', verdict: 'uncertain', status: 'completed' },
    { checkId: 'e', verdict: 'agree', status: 'skipped' },
    { checkId: 'f', verdict: 'uncertain', status: 'error' },
  ];

  const summary = summariseJudgeReviews(reviews);

  assert.equal(summary.total, 6);
  assert.equal(summary.agreed, 2);
  assert.equal(summary.disagreed, 1);
  assert.equal(summary.uncertain, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.errors, 1);
  assert.ok(summary.summary.includes('2 agreed'));
  assert.ok(summary.summary.includes('1 disagreed'));
  assert.ok(summary.summary.includes('1 uncertain'));
  assert.ok(summary.summary.includes('1 skipped'));
  assert.ok(summary.summary.includes('1 errors'));
});

check('summariseJudgeReviews handles empty/null input', () => {
  const empty = summariseJudgeReviews([]);
  assert.equal(empty.total, 0);

  const nullish = summariseJudgeReviews(null);
  assert.equal(nullish.total, 0);
});

// --- summary -----------------------------------------------------------------

const failed = results.filter(r => !r.ok);
process.stdout.write(`${JSON.stringify({
  status: failed.length ? 'error' : 'success',
  summary: `${results.length - failed.length}/${results.length} judge evaluator checks passed.`,
  next_actions: failed.length ? ['Fix failing judge evaluator checks.'] : [],
  artifacts: ['tests/evaluators/judge/run.mjs'],
  ...(failed.length ? { failures: failed } : {}),
}, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
