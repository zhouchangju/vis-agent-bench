/**
 * Blind-review classification for human review packages.
 *
 * The reviewer must be free to judge a Run without learning which model
 * produced it. This module declares which fields are reviewer-visible by
 * default, which fields are hidden during blind review, and provides a
 * helper that strips model-identifying fields from a review package before
 * it is shown to a blind reviewer.
 *
 * Hidden (model identity):
 *   - run_id when it contains an adapter token like "codex", "kimi", "claude".
 *   - reviewer identity (the reviewer is still required, but the package
 *     shown to a *different* blind reviewer masks the original reviewer).
 *   - free-text observation fields are NOT auto-redacted: reviewers must
 *     avoid naming the model. The prototype warns them.
 *
 * Visible (reviewer needs them):
 *   - case_id, scores, human_time, convergence, decision, observations
 *   - machine evidence summaries, screenshots, DOM snapshots, structured
 *     failures — these describe the artifact, not the model.
 */

const ADAPTER_TOKENS = ['codex', 'kimi', 'claude'];

export function looksLikeModelIdentifier(value) {
  if (typeof value !== 'string' || !value) return false;
  const lower = value.toLowerCase();
  return ADAPTER_TOKENS.some(token => lower.includes(token));
}

/**
 * Return a shallow copy of the review package with model-identifying fields
 * redacted for blind review. The original is not mutated.
 */
export function redactPackageForBlindReview(pkg) {
  if (!pkg || typeof pkg !== 'object') return pkg;
  const next = { ...pkg };
  if (looksLikeModelIdentifier(next.run_id)) {
    next.run_id = '[blind:run_id]';
  }
  if (next.reviewer && typeof next.reviewer === 'string') {
    next.reviewer = '[blind:reviewer]';
  }
  if (Array.isArray(next.reviews)) {
    next.reviews = next.reviews.map(review => {
      if (!review || typeof review !== 'object') return review;
      const copy = { ...review };
      if (copy.machine_evidence && typeof copy.machine_evidence === 'object') {
        // Preserve capture_id/run_id linkage for traceability, but strip any
        // model adapter token that may have leaked into capture_id.
        if (looksLikeModelIdentifier(copy.machine_evidence.capture_id)) {
          copy.machine_evidence = { ...copy.machine_evidence, capture_id: '[blind:capture_id]' };
        }
      }
      return copy;
    });
  }
  next.blind_review = true;
  return next;
}

/**
 * Produce a single string describing the blind-review state of a package.
 * Useful for the review prototype's status banner.
 */
export function describeBlindState(pkg) {
  if (!pkg || typeof pkg !== 'object') return 'unknown';
  if (pkg.blind_review === true) {
    return looksLikeModelIdentifier(pkg.run_id)
      ? 'blind-on (run_id still contains adapter token; rerun redaction)'
      : 'blind-on';
  }
  return 'blind-off';
}

export const BLIND_HIDDEN_HINT = '隐藏的盲评字段：reviewer、含模型 adapter token 的 run_id / capture_id。机器证据（截图、DOM、结构化失败）保留可见，因为它们描述工件而不是模型。';
