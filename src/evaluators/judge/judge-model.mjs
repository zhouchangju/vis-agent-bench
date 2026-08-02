// Judge model review (LLM-as-Judge).
//
// The Judge is a non-deterministic layer that performs a secondary review of
// evaluation results produced by deterministic evaluators. It never replaces
// a deterministic check — its verdict is stored separately and serves as an
// additional signal for human reviewers.
//
// The module is intentionally free of npm dependencies. Judge providers
// (e.g. OpenAI-compatible APIs) are abstracted behind a minimal interface so
// they can be plugged in later without changing call sites.

// --- Prompt construction ----------------------------------------------------

// Build a structured prompt for the Judge model to review one check result.
//
// Required inputs:
//   caseId           - stable case identifier
//   checkId          - the check under review
//   scenario         - short description of the evaluation scenario
//   evaluationResult - the deterministic evaluator's outcome for this check
//   observationSummary - condensed description of what was observed
//   context          - arbitrary additional context (rubric notes, etc.)
//
// Returns { role: 'user', content: '...' } suitable for an LLM chat API.
export function buildJudgeReviewPrompt({
  caseId,
  checkId,
  scenario,
  evaluationResult,
  observationSummary,
  context,
}) {
  const status = evaluationResult?.status ?? 'unknown';
  const reason = evaluationResult?.reason ?? 'no reason provided';
  const evidence = summariseEvidence(evaluationResult?.evidence);

  const lines = [
    'You are a Judge model performing secondary review of a deterministic evaluator result.',
    '',
    'Your task: review the evaluation below and decide whether you agree, disagree, or are uncertain.',
    '',
    '--- CASE ---',
    `case_id: ${caseId ?? 'unspecified'}`,
    `check_id: ${checkId ?? 'unspecified'}`,
    `scenario: ${scenario ?? 'unspecified'}`,
    '',
    '--- DETERMINISTIC EVALUATION ---',
    `status: ${status}`,
    `reason: ${reason}`,
    evidence ? `evidence: ${evidence}` : 'evidence: none',
    '',
    '--- OBSERVATION ---',
    observationSummary ?? 'no observation provided',
    '',
    ...(context ? ['--- ADDITIONAL CONTEXT ---', String(context), ''] : []),
    '--- INSTRUCTIONS ---',
    '1. Review the deterministic evaluation against the observation.',
    '2. Respond with exactly one of these verdicts: agree, disagree, or uncertain.',
    '3. Provide your confidence as a number between 0.0 and 1.0.',
    '4. Include a brief reasoning (1-3 sentences).',
    '5. If you disagree, include a constructive suggestion.',
    '',
    'Format your response exactly like this:',
    '<verdict>agree|disagree|uncertain</verdict>',
    '<confidence>0.0-1.0</confidence>',
    '<reasoning>Your reasoning here.</reasoning>',
    '<suggestion>Your suggestion here (optional).</suggestion>',
  ];

  return {
    role: 'user',
    content: lines.join('\n'),
  };
}

function summariseEvidence(evidence) {
  if (evidence == null) return null;
  if (typeof evidence === 'string') return evidence.length > 500 ? evidence.slice(0, 500) + '...' : evidence;
  try {
    const s = JSON.stringify(evidence);
    return s.length > 500 ? s.slice(0, 500) + '...' : s;
  } catch {
    return null;
  }
}

// --- Verdict parsing --------------------------------------------------------

// Parse a Judge model response into a structured verdict.
//
//   response           - the raw text returned by the Judge model
//   checkExpectations  - optional object with expected fields (unused currently,
//                        reserved for future validation)
//
// Returns {
//   verdict: 'agree' | 'disagree' | 'uncertain',
//   confidence: number (0-1),
//   reasoning: string,
//   suggestion: string,
// }
export function parseJudgeVerdict(response, _checkExpectations) {
  if (typeof response !== 'string' || !response.trim()) {
    return {
      verdict: 'uncertain',
      confidence: 0,
      reasoning: 'Empty or non-string response from Judge model.',
      suggestion: '',
    };
  }

  const verdict = extractTag(response, 'verdict');
  const confidenceRaw = extractTag(response, 'confidence');
  const reasoning = extractTag(response, 'reasoning');
  const suggestion = extractTag(response, 'suggestion');

  const normalisedVerdict = normaliseVerdict(verdict);
  const confidence = parseConfidence(confidenceRaw);

  return {
    verdict: normalisedVerdict,
    confidence,
    reasoning: reasoning || 'No reasoning provided.',
    suggestion: suggestion || '',
  };
}

function extractTag(text, tagName) {
  const regex = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function normaliseVerdict(raw) {
  if (!raw) return 'uncertain';
  const lower = raw.toLowerCase().trim();
  if (lower === 'agree') return 'agree';
  if (lower === 'disagree') return 'disagree';
  return 'uncertain';
}

function parseConfidence(raw) {
  if (!raw) return 0;
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, Math.round(num * 100) / 100));
}

// --- Judge review orchestration ---------------------------------------------

// Run a Judge review for a single check.
//
// Options:
//   checkId            - the check identifier
//   observation        - observation data (string or object)
//   evaluationResult   - the deterministic evaluator's result
//   scenario           - scenario description
//   judgeProvider      - 'mock' | 'openai-compatible' | 'none' (default: 'none')
//   judgeModel         - model identifier (used when provider is real)
//   judgeApiKey        - API key (reserved for future use)
//   judgeBaseUrl       - API base URL (reserved for future use)
//
// Returns {
//   checkId, verdict, confidence, reasoning, suggestion,
//   status: 'completed' | 'skipped' | 'error',
//   model, tokens,
// }
export async function runJudgeReview({
  checkId,
  observation,
  evaluationResult,
  scenario,
  judgeProvider = 'none',
  judgeModel,
  judgeApiKey,
  judgeBaseUrl,
}) {
  if (!checkId || typeof checkId !== 'string') {
    return {
      checkId: checkId || 'unknown',
      verdict: 'uncertain',
      confidence: 0,
      reasoning: 'Invalid checkId provided.',
      suggestion: '',
      status: 'error',
      model: null,
      tokens: null,
    };
  }

  const provider = normaliseProvider(judgeProvider);

  if (provider === 'none') {
    return {
      checkId,
      verdict: 'uncertain',
      confidence: 0,
      reasoning: 'Judge review not requested (provider is none).',
      suggestion: '',
      status: 'skipped',
      model: null,
      tokens: null,
    };
  }

  if (provider === 'mock') {
    const observationStr = typeof observation === 'string'
      ? observation
      : (observation ? JSON.stringify(observation).slice(0, 200) : 'no observation');

    const resultStatus = evaluationResult?.status ?? 'unknown';
    const verdict = deriveMockVerdict(resultStatus);
    const model = judgeModel || 'mock-judge-v0';

    return {
      checkId,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
      suggestion: verdict.suggestion,
      status: 'completed',
      model,
      tokens: null,
      mock: true,
    };
  }

  if (provider === 'openai-compatible') {
    // Placeholder: real API integration is deferred until the project has
    // API key management and cost tracking. The interface is designed so
    // that only runJudgeReview needs to change when we add it.
    return {
      checkId,
      verdict: 'uncertain',
      confidence: 0,
      reasoning: 'OpenAI-compatible judge provider is not yet configured.',
      suggestion: '',
      status: 'skipped',
      model: judgeModel || null,
      tokens: null,
      reason: 'judge_provider_not_configured',
    };
  }

  return {
    checkId,
    verdict: 'uncertain',
    confidence: 0,
    reasoning: `Unknown judge provider: ${provider}`,
    suggestion: '',
    status: 'error',
    model: null,
    tokens: null,
  };
}

function normaliseProvider(raw) {
  if (!raw || typeof raw !== 'string') return 'none';
  const lower = raw.toLowerCase().trim();
  if (lower === 'mock') return 'mock';
  if (lower === 'openai' || lower === 'openai-compatible' || lower === 'openai_compatible') {
    return 'openai-compatible';
  }
  return lower;
}

function deriveMockVerdict(evaluationStatus) {
  // The mock Judge produces predictable but plausible verdicts for testing.
  // It agrees with pass/warning, disagrees with error, and is uncertain
  // about fail or unknown statuses.
  switch (evaluationStatus) {
    case 'pass':
      return {
        verdict: 'agree',
        confidence: 0.92,
        reasoning: 'Mock Judge agrees: the observation is consistent with a passing check.',
        suggestion: '',
      };
    case 'warning':
      return {
        verdict: 'agree',
        confidence: 0.78,
        reasoning: 'Mock Judge agrees with the warning: the observation shows minor deviations.',
        suggestion: 'Consider tightening the threshold for a clearer pass/fail boundary.',
      };
    case 'fail':
      return {
        verdict: 'uncertain',
        confidence: 0.55,
        reasoning: 'Mock Judge is uncertain: the failure may be a borderline case.',
        suggestion: 'Re-examine the observation manually to confirm the failure is genuine.',
      };
    case 'error':
      return {
        verdict: 'disagree',
        confidence: 0.85,
        reasoning: 'Mock Judge disagrees: the evaluator error appears to be a harness fault, not a project defect.',
        suggestion: 'Investigate the evaluator harness before attributing this to the project.',
      };
    case 'skipped':
      return {
        verdict: 'agree',
        confidence: 0.9,
        reasoning: 'Mock Judge agrees: skipping was appropriate given unmet preconditions.',
        suggestion: '',
      };
    default:
      return {
        verdict: 'uncertain',
        confidence: 0.4,
        reasoning: 'Mock Judge cannot assess: the evaluation status is unrecognised.',
        suggestion: 'Review the evaluation result format.',
      };
  }
}
