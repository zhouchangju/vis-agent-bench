// Markdown renderer for the VAB-T07 report.
//
// Input: a JSON report that conforms to schemas/report.schema.json.
// Output: a Markdown string suitable for review in the repo and pasting into
// leadership updates. The renderer never fetches additional files; it only
// formats the structured report it was given.

const VERDICT_LABEL = {
  'replaceable-delivery': 'Replaceable delivery',
  'high-value-assist': 'High-value assist',
  'limited-assist': 'Limited assist',
  'not-applicable': 'Not applicable',
};

const JUDGMENT_LABEL = {
  'replaceable-delivery': 'Replaceable delivery',
  'high-value-assist': 'High-value assist',
  'limited-assist': 'Limited assist',
  'not-applicable': 'Not applicable',
  'unknown': 'Unknown',
};

const P0_LABEL = {
  passed: 'P0 passed',
  partial: 'P0 partial',
  failed: 'P0 failed',
  unknown: 'P0 unknown',
};

const FACT_LAYER_LABEL = {
  machine: 'Machine facts',
  human: 'Human observations',
  inferred: 'Computed inferences',
  unverified: 'Unverified claims',
};

export function renderMarkdown(report) {
  validateReportShape(report);
  const lines = [];
  const title = report.title || `Report ${report.report_id}`;
  lines.push(`# ${title}`);
  lines.push('');
  if (report.view?.demo) {
    lines.push('> ⚠️ **DEMO DATA** — at least one input run is marked DEMO. Numbers below must not be mixed into the real leaderboard.');
    lines.push('');
  }
  lines.push(`- Report ID: \`${report.report_id}\``);
  lines.push(`- Generated: ${report.generated_at}`);
  lines.push(`- View: ${report.view?.kind} (runs: ${report.view?.scope?.run_ids?.length ?? 0})`);
  lines.push(`- Evidence completeness: ${report.evidence_completeness.percent}%`);
  if (report.evidence_completeness.missing.length) {
    lines.push(`- Missing evidence: ${report.evidence_completeness.missing.join(', ')}`);
  }
  lines.push('');

  lines.push('## Leadership summary');
  lines.push('');
  const summary = report.leadership_summary;
  lines.push(`**Verdict:** ${summary.verdict ? VERDICT_LABEL[summary.verdict] || summary.verdict : 'unavailable'}`);
  lines.push('');
  lines.push(summary.headline);
  lines.push('');
  lines.push('| Metric | Value | Notes |');
  lines.push('| --- | --- | --- |');
  lines.push(`| Effective speedup | ${formatSpeedup(summary.effective_speedup)} | ${summary.effective_speedup.eligible ? 'accepted runs only' : 'not eligible until at least one run is accepted'} |`);
  lines.push(`| Accepted delivery rate | ${formatRate(summary.accepted_delivery_rate)} | source: ${summary.accepted_delivery_rate.source} |`);
  lines.push('');

  lines.push('## Human touch time');
  lines.push('');
  const ht = report.human_touch_breakdown;
  if (ht.source === 'unavailable') {
    lines.push('_No accepted human review yet; Human Touch Time cannot be computed._');
  } else {
    lines.push('| Bucket | Minutes |');
    lines.push('| --- | --- |');
    for (const [key, value] of Object.entries(ht)) {
      if (key === 'source' || key === 'total_minutes') continue;
      lines.push(`| ${labelForBucket(key)} | ${formatMinutes(value)} |`);
    }
    lines.push(`| **Total** | ${formatMinutes(ht.total_minutes)} |`);
    if (ht.source === 'partial') {
      lines.push('');
      lines.push('_Partial source: some runs lack a human review; totals may undercount._');
    }
  }
  lines.push('');

  if (report.cost_summary) {
    lines.push('## Cost & token availability');
    lines.push('');
    const cost = report.cost_summary;
    lines.push(`- Availability: ${cost.availability}`);
    lines.push(`- Reported USD cost: ${cost.reported_cost_usd == null ? 'unavailable' : `$${cost.reported_cost_usd.toFixed(4)}`}`);
    if (cost.reported_tokens) {
      lines.push(`- Reported tokens: input ${cost.reported_tokens.input_tokens}, output ${cost.reported_tokens.output_tokens}, cached ${cost.reported_tokens.cached_tokens}`);
    } else {
      lines.push('- Reported tokens: unavailable');
    }
    lines.push(`- ${cost.currency_note}`);
    lines.push('');
  }

  if (report.capability_boundaries?.length) {
    lines.push('## Capability boundaries');
    lines.push('');
    for (const boundary of report.capability_boundaries) {
      lines.push(`### ${JUDGMENT_LABEL[boundary.judgment] || boundary.judgment}`);
      lines.push('');
      lines.push(`Scope: ${boundary.scope}`);
      lines.push('');
      lines.push(boundary.detail);
      lines.push('');
      if (boundary.evidence_refs?.length) {
        lines.push(`Evidence: ${boundary.evidence_refs.join(', ')}`);
        lines.push('');
      }
    }
  }

  if (report.case_conclusions?.length) {
    lines.push('## Case conclusions');
    lines.push('');
    lines.push('| Case | Decision | P0 | Judgment | Scores (B/V/I/U) |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const conclusion of report.case_conclusions) {
      const scores = conclusion.scores
        ? `${scoreOrDash(conclusion.scores.business)}/${scoreOrDash(conclusion.scores.visual)}/${scoreOrDash(conclusion.scores.interaction)}/${scoreOrDash(conclusion.scores.usability)}`
        : '—';
      lines.push(`| ${conclusion.case_id} | ${conclusion.decision || '—'} | ${P0_LABEL[conclusion.p0_state]} | ${JUDGMENT_LABEL[conclusion.judgment] || conclusion.judgment} | ${scores} |`);
    }
    lines.push('');
    for (const conclusion of report.case_conclusions) {
      if (conclusion.detail) {
        lines.push(`**${conclusion.case_id}:** ${conclusion.detail}`);
        lines.push('');
      }
    }
  }

  if (report.failure_modes?.length) {
    lines.push('## Failure modes');
    lines.push('');
    for (const failure of report.failure_modes) {
      lines.push(`- **${failure.title}** _(${failure.source})_`);
      if (failure.detail) lines.push(`  - ${failure.detail}`);
      if (failure.evidence_refs?.length) lines.push(`  - Evidence: ${failure.evidence_refs.join(', ')}`);
    }
    lines.push('');
  } else {
    lines.push('## Failure modes');
    lines.push('');
    lines.push('_No failure modes recorded._');
    lines.push('');
  }

  if (report.recommended_actions?.length) {
    lines.push('## Recommended actions');
    lines.push('');
    for (const action of report.recommended_actions) {
      lines.push(`- **[${action.priority.toUpperCase()}]** ${action.title}`);
      lines.push(`  - ${action.rationale}`);
    }
    lines.push('');
  }

  lines.push('## Fact layers');
  lines.push('');
  for (const [layer, facts] of Object.entries(report.fact_layers || {})) {
    if (!facts?.length) continue;
    lines.push(`### ${FACT_LAYER_LABEL[layer] || layer}`);
    lines.push('');
    for (const fact of facts) {
      lines.push(`- \`${fact.id}\` ${fact.statement}`);
      if (fact.evidence_refs?.length) lines.push(`  - Evidence: ${fact.evidence_refs.join(', ')}`);
    }
    lines.push('');
  }

  if (report.evidence_index?.length) {
    lines.push('## Evidence index');
    lines.push('');
    lines.push('| Handle | Kind | Label |');
    lines.push('| --- | --- | --- |');
    for (const item of report.evidence_index) {
      lines.push(`| \`${item.handle}\` | ${item.kind} | ${item.label} |`);
    }
    lines.push('');
  }

  lines.push('## Data provenance');
  lines.push('');
  lines.push(`- Demo inputs present: ${report.data_provenance.demo_inputs_present ? 'yes' : 'no'}`);
  lines.push(`- Leaderboard eligible: ${report.data_provenance.leaderboard_eligible ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('| Run | Case | Model | Human review | Evaluator | Accepted | Demo |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const input of report.data_provenance.inputs) {
    lines.push(`| ${input.run_id} | ${input.case_id} | ${input.model_label} | ${input.has_human_review ? 'yes' : 'no'} | ${input.has_evaluator ? 'yes' : 'no'} | ${input.accepted ? 'yes' : 'no'} | ${input.demo ? 'yes' : 'no'} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function validateReportShape(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Cannot render Markdown: report must be an object.');
  }
  for (const field of ['report_id', 'generated_at', 'view', 'leadership_summary']) {
    if (!(field in report)) throw new Error(`Cannot render Markdown: report is missing required field ${field}.`);
  }
}

function labelForBucket(key) {
  return {
    clarification_minutes: 'Requirement clarification',
    context_prep_minutes: 'Context / spec preparation',
    poc_review_minutes: 'POC review',
    micro_adjustment_minutes: 'Visual / interaction micro-adjustment',
    fix_minutes: 'Defect & regression fixes',
    final_review_minutes: 'Final acceptance',
  }[key] || key;
}

function formatMinutes(value) {
  if (value == null) return 'unavailable';
  if (value === 0) return '0';
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function formatSpeedup(speedup) {
  if (!speedup) return 'unavailable';
  if (!speedup.eligible || speedup.ratio == null) return 'not eligible';
  return `${speedup.ratio}× (baseline ${formatMinutes(speedup.baseline_minutes)} / candidate ${formatMinutes(speedup.candidate_minutes)})`;
}

function formatRate(rate) {
  if (!rate || rate.percent == null) return 'unavailable';
  return `${rate.percent}% (${rate.accepted}/${rate.reviewed})`;
}

function scoreOrDash(value) {
  return typeof value === 'number' ? String(value) : '—';
}
