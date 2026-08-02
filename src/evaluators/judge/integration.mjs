// Judge model integration into the evaluator lifecycle.
//
// These functions connect Judge reviews to the existing deterministic
// evaluation flow without modifying the core lifecycle, scoring, or
// evidence modules. Judge verdicts are stored as supplementary data
// separate from deterministic check statuses.

import { isExecuted } from '../core/status.mjs';

// Select which checks should be sent to the Judge for secondary review.
//
// Returns an array of check metadata objects describing checks that need
// Judge review. Selection logic:
//
//   1. Checks explicitly annotated with `judge_review: true` in the rubric.
//   2. Checks whose execution status is `fail` or `warning` and that belong
//      to a "soft" category (i.e. not hard gates).
//
//   rubric            - the parsed rubric object (v1 or legacy, already normalised)
//   evaluationResults  - array of CheckResult objects from the evaluator run
//
// Returns { checkId, reason, level, category, status }
export function selectChecksForJudgeReview(rubric, evaluationResults) {
  if (!Array.isArray(evaluationResults)) {
    throw new TypeError('selectChecksForJudgeReview: evaluationResults must be an array.');
  }

  const selected = [];
  const seen = new Set();

  // Build a lookup of rubric-level judge_review annotations.
  // The rubric may have a top-level `judge_review` mapping: { checkId: true, ... }
  // or individual check entries may carry the flag.
  const judgeReviewFlags = collectJudgeReviewFlags(rubric);

  for (const result of evaluationResults) {
    const checkId = result.check_id;

    // Rule 1: explicit flag in rubric
    if (judgeReviewFlags.has(checkId)) {
      if (!seen.has(checkId)) {
        seen.add(checkId);
        selected.push({
          checkId,
          reason: 'rubric-flagged',
          level: result.level || null,
          category: result.category || null,
          status: result.status,
        });
      }
      continue;
    }

    // Rule 2: fail/warn checks that executed (not skipped, not error)
    if (
      result.status === 'fail' || result.status === 'warning'
    ) {
      if (!seen.has(checkId)) {
        seen.add(checkId);
        selected.push({
          checkId,
          reason: 'executed-' + result.status,
          level: result.level || null,
          category: result.category || null,
          status: result.status,
        });
      }
    }
  }

  return selected;
}

// Walk the rubric structure to discover which checks have judge_review: true.
function collectJudgeReviewFlags(rubric) {
  const flags = new Set();

  if (!rubric || typeof rubric !== 'object') return flags;

  // v1 rubric with categories
  if (rubric.version === 1 && rubric.categories) {
    for (const category of Object.values(rubric.categories)) {
      if (category.judge_review_checks && Array.isArray(category.judge_review_checks)) {
        for (const id of category.judge_review_checks) {
          flags.add(id);
        }
      }
      // Also check per-check entries within categories
      if (category.checks_metadata && typeof category.checks_metadata === 'object') {
        for (const [checkId, meta] of Object.entries(category.checks_metadata)) {
          if (meta && meta.judge_review === true) {
            flags.add(checkId);
          }
        }
      }
    }
  }

  // Top-level judge_review_checks array
  if (Array.isArray(rubric.judge_review_checks)) {
    for (const id of rubric.judge_review_checks) {
      flags.add(id);
    }
  }

  return flags;
}

// Attach Judge verdicts to an evidence bundle's results.
//
// Judge verdicts are stored in a separate `judge_verdict` field on each
// result — they never modify the original check status. This preserves
// the deterministic result while still making the Judge's opinion
// available to reviewers and reporters.
//
//   bundle        - the evidence bundle produced by createEvidenceBundle
//   judgeReviews  - array of Judge review results from runJudgeReview
//
// Returns a new bundle object (the original is not mutated).
export function attachJudgeVerdicts(bundle, judgeReviews) {
  if (!bundle || typeof bundle !== 'object') {
    throw new TypeError('attachJudgeVerdicts: bundle must be an object.');
  }
  if (!Array.isArray(judgeReviews)) {
    throw new TypeError('attachJudgeVerdicts: judgeReviews must be an array.');
  }

  const verdictMap = new Map();
  for (const review of judgeReviews) {
    if (review && review.checkId) {
      verdictMap.set(review.checkId, sanitiseVerdict(review));
    }
  }

  const updatedResults = (bundle.results || []).map(result => {
    const checkId = result.check_id;
    const verdict = verdictMap.get(checkId);
    if (verdict) {
      return {
        ...result,
        judge_verdict: verdict,
      };
    }
    return result;
  });

  return {
    ...bundle,
    results: updatedResults,
    judge_review: {
      total_reviewed: verdictMap.size,
      provider: inferProvider(judgeReviews),
      reviews: [...verdictMap.values()],
    },
  };
}

function sanitiseVerdict(review) {
  return {
    check_id: review.checkId,
    verdict: review.verdict || 'uncertain',
    confidence: typeof review.confidence === 'number' ? review.confidence : 0,
    reasoning: review.reasoning || '',
    suggestion: review.suggestion || '',
    status: review.status || 'error',
    model: review.model || null,
    tokens: review.tokens || null,
    mock: review.mock === true ? true : undefined,
  };
}

function inferProvider(reviews) {
  if (!reviews.length) return 'none';
  const first = reviews[0];
  if (first.mock === true) return 'mock';
  if (first.model) return 'openai-compatible';
  return 'none';
}

// Build a summary of Judge reviews suitable for human-readable output.
//
//   judgeReviews  - array of Judge review results
//
// Returns { total, agreed, disagreed, uncertain, skipped, errors, summary }
export function summariseJudgeReviews(judgeReviews) {
  if (!Array.isArray(judgeReviews)) {
    return { total: 0, agreed: 0, disagreed: 0, uncertain: 0, skipped: 0, errors: 0, summary: 'No judge reviews.' };
  }

  const counts = { agreed: 0, disagreed: 0, uncertain: 0, skipped: 0, errors: 0 };
  for (const review of judgeReviews) {
    if (review.status === 'skipped') {
      counts.skipped++;
    } else if (review.status === 'error') {
      counts.errors++;
    } else if (review.verdict === 'agree') {
      counts.agreed++;
    } else if (review.verdict === 'disagree') {
      counts.disagreed++;
    } else {
      counts.uncertain++;
    }
  }

  const total = judgeReviews.length;
  const parts = [];
  if (counts.agreed) parts.push(`${counts.agreed} agreed`);
  if (counts.disagreed) parts.push(`${counts.disagreed} disagreed`);
  if (counts.uncertain) parts.push(`${counts.uncertain} uncertain`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  if (counts.errors) parts.push(`${counts.errors} errors`);

  return {
    total,
    ...counts,
    summary: parts.length ? `Judge review: ${parts.join(', ')}.` : 'Judge review: none.',
  };
}
