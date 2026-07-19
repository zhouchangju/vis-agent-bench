// Standalone HTML renderer for the VAB-T07 report.
//
// The renderer produces a self-contained HTML document so the file can be
// opened directly in a browser without an extra stylesheet. It deliberately
// avoids scripts and external network resources; the prototype page
// (prototype/report.html) remains the styled, interactive mock-up.

const VERDICT_STATUS_CLASS = {
  'replaceable-delivery': 'good',
  'high-value-assist': 'good',
  'limited-assist': 'warn',
  'not-applicable': 'bad',
};

const P0_STATUS_CLASS = {
  passed: 'good',
  partial: 'warn',
  failed: 'bad',
  unknown: 'info',
};

const P0_LABEL = {
  passed: 'P0 passed',
  partial: 'P0 partial',
  failed: 'P0 failed',
  unknown: 'P0 unknown',
};

const VERDICT_LABEL = {
  'replaceable-delivery': 'Replaceable delivery',
  'high-value-assist': 'High-value assist',
  'limited-assist': 'Limited assist',
  'not-applicable': 'Not applicable',
};

export function renderHtml(report) {
  validateReportShape(report);
  const title = escapeHtml(report.title || `Report ${report.report_id}`);
  const parts = [htmlHead(title), htmlBodyStart(report, title)];
  parts.push(htmlLeadership(report));
  parts.push(htmlMetrics(report));
  parts.push(htmlHumanTouch(report));
  parts.push(htmlCost(report));
  parts.push(htmlCapability(report));
  parts.push(htmlCaseConclusions(report));
  parts.push(htmlFailureModes(report));
  parts.push(htmlRecommendedActions(report));
  parts.push(htmlFactLayers(report));
  parts.push(htmlEvidenceIndex(report));
  parts.push(htmlDataProvenance(report));
  parts.push(htmlBodyEnd());
  return parts.join('');
}

function validateReportShape(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Cannot render HTML: report must be an object.');
  }
  for (const field of ['report_id', 'generated_at', 'view', 'leadership_summary']) {
    if (!(field in report)) throw new Error(`Cannot render HTML: report is missing required field ${field}.`);
  }
}

function htmlHead(title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
`;
}

function htmlBodyStart(report, title) {
  const demoBanner = report.view?.demo
    ? `<div class="demo-ribbon"><b>DEMO DATA</b> At least one input run is marked DEMO. Do not mix these numbers into the real leaderboard.</div>`
    : '';
  const verdict = report.leadership_summary?.verdict;
  const verdictClass = VERDICT_STATUS_CLASS[verdict] || 'info';
  const verdictLabel = verdict ? (VERDICT_LABEL[verdict] || verdict) : 'Verdict unavailable';
  const evidenceStatus = report.evidence_completeness?.percent === 100 ? 'good' : (report.evidence_completeness?.percent >= 50 ? 'warn' : 'bad');
  return `<main class="shell">
<header class="topbar">
  <div class="brand"><span class="brand-mark">VAB</span>Vis Agent Bench Report</div>
  <div class="top-meta">REPORT / ${escapeHtml(report.report_id)} / ${escapeHtml(report.generated_at)}</div>
</header>
${demoBanner}
<section class="report-hero">
  <div class="verdict">
    <span class="status ${verdictClass}">Verdict: ${escapeHtml(verdictLabel)}</span>
    <h1>${escapeHtml(report.leadership_summary?.headline || title)}</h1>
    <p>View: ${escapeHtml(report.view?.kind || 'unknown')} · ${report.view?.scope?.run_ids?.length ?? 0} run(s) · Evidence completeness ${report.evidence_completeness?.percent ?? 0}%.</p>
    <div class="speed-number"><b>${formatSpeedupShort(report.leadership_summary?.effective_speedup)}</b><span>Effective speedup · ${report.leadership_summary?.effective_speedup?.eligible ? 'accepted deliveries only' : 'not eligible until a delivery is accepted'}</span></div>
  </div>
  <aside class="decision-panel">
    <div>
      <div class="eyebrow">Executive summary</div>
      <h2>What this report answers</h2>
      <div class="decision-list">
        <div class="decision-item"><b>1</b><span>${escapeHtml(report.leadership_summary?.accepted_delivery_rate?.source === 'human-review' ? `Accepted delivery rate ${report.leadership_summary.accepted_delivery_rate.percent}%.` : 'Accepted delivery rate unavailable until reviews are complete.')}</span></div>
        <div class="decision-item"><b>2</b><span>Effective speedup is only computed over accepted deliveries.</span></div>
        <div class="decision-item"><b>3</b><span>${report.view?.demo ? 'DEMO inputs present — keep this report out of the real leaderboard.' : 'No DEMO inputs detected in this report.'}</span></div>
      </div>
    </div>
    <span class="status ${evidenceStatus}">Evidence completeness ${report.evidence_completeness?.percent ?? 0}%</span>
  </aside>
</section>
`;
}

function htmlLeadership(report) {
  const summary = report.leadership_summary;
  return `<section class="card">
  <header class="card-head"><h2>Leadership summary</h2><span class="status info">decision inputs</span></header>
  <div class="card-body">
    <p class="lead">${escapeHtml(summary?.headline || '')}</p>
    <dl class="kv">
      <dt>Verdict</dt><dd>${escapeHtml(VERDICT_LABEL[summary?.verdict] || summary?.verdict || 'unavailable')}</dd>
      <dt>Effective speedup</dt><dd>${escapeHtml(formatSpeedup(summary?.effective_speedup))}</dd>
      <dt>Accepted delivery rate</dt><dd>${escapeHtml(formatRate(summary?.accepted_delivery_rate))}</dd>
    </dl>
  </div>
</section>
`;
}

function htmlMetrics(report) {
  const summary = report.leadership_summary;
  const ht = report.human_touch_breakdown;
  const totalMinutes = ht?.total_minutes;
  const acceptedPercent = summary?.accepted_delivery_rate?.percent;
  return `<section class="metric-grid">
  <div class="metric"><div class="label">Effective speedup</div><div class="value">${formatSpeedupShort(summary?.effective_speedup)}</div><div class="delta">${summary?.effective_speedup?.eligible ? 'accepted runs only' : 'not eligible yet'}</div></div>
  <div class="metric"><div class="label">Accepted delivery rate</div><div class="value">${acceptedPercent == null ? '—' : acceptedPercent + '%'}</div><div class="delta">${summary?.accepted_delivery_rate?.accepted ?? 0}/${summary?.accepted_delivery_rate?.reviewed ?? 0} reviewed</div></div>
  <div class="metric"><div class="label">Human touch time</div><div class="value">${formatMinutesShort(totalMinutes)}</div><div class="delta">source: ${escapeHtml(ht?.source || 'unavailable')}</div></div>
  <div class="metric"><div class="label">Evidence completeness</div><div class="value">${report.evidence_completeness?.percent ?? 0}%</div><div class="delta">${report.evidence_completeness?.missing?.length ? 'missing: ' + escapeHtml(report.evidence_completeness.missing.join(', ')) : 'all required evidence present'}</div></div>
</section>
`;
}

function htmlHumanTouch(report) {
  const ht = report.human_touch_breakdown;
  if (!ht || ht.source === 'unavailable') {
    return `<section class="card">
  <header class="card-head"><h2>Human touch time</h2><span class="status bad">unavailable</span></header>
  <div class="card-body"><p class="muted">No accepted human review yet. Human Touch Time cannot be computed.</p></div>
</section>
`;
  }
  const rows = Object.entries(ht)
    .filter(([key]) => !['source', 'total_minutes'].includes(key))
    .map(([key, value]) => {
      const maxValue = Math.max(1, ...Object.entries(ht)
        .filter(([k]) => !['source', 'total_minutes'].includes(k))
        .map(([, v]) => v || 0));
      const pct = value == null ? 0 : Math.round((value / maxValue) * 100);
      return `<div class="bar-row"><span>${escapeHtml(labelForBucket(key))}</span><div class="bar-track"><div class="bar-fill human" style="width:${pct}%"></div></div><span class="bar-value">${escapeHtml(formatMinutes(value))}</span></div>`;
    })
    .join('');
  const partialNote = ht.source === 'partial'
    ? '<p class="footnote">Partial source: some runs lack a human review; totals may undercount.</p>'
    : '';
  return `<section class="card">
  <header class="card-head"><h2>Human touch time</h2><span class="status info">human touch breakdown</span></header>
  <div class="card-body bar-list">
    ${rows}
    <div class="bar-row"><span><b>Total</b></span><div class="bar-track"></div><span class="bar-value"><b>${escapeHtml(formatMinutes(ht.total_minutes))}</b></span></div>
    ${partialNote}
  </div>
</section>
`;
}

function htmlCost(report) {
  const cost = report.cost_summary;
  if (!cost) return '';
  const availabilityClass = cost.availability === 'reported' ? 'good' : (cost.availability === 'partial' ? 'warn' : 'bad');
  const tokenText = cost.reported_tokens
    ? `input ${cost.reported_tokens.input_tokens.toLocaleString()} · output ${cost.reported_tokens.output_tokens.toLocaleString()} · cached ${cost.reported_tokens.cached_tokens.toLocaleString()}`
    : 'unavailable';
  const costText = cost.reported_cost_usd == null ? 'unavailable' : `$${cost.reported_cost_usd.toFixed(4)}`;
  return `<section class="card">
  <header class="card-head"><h2>Cost &amp; token availability</h2><span class="status ${availabilityClass}">${escapeHtml(cost.availability)}</span></header>
  <div class="card-body">
    <dl class="kv">
      <dt>Reported USD cost</dt><dd>${escapeHtml(costText)}</dd>
      <dt>Reported tokens</dt><dd>${escapeHtml(tokenText)}</dd>
    </dl>
    <p class="footnote">${escapeHtml(cost.currency_note || '')}</p>
  </div>
</section>
`;
}

function htmlCapability(report) {
  if (!report.capability_boundaries?.length) return '';
  const items = report.capability_boundaries.map(b => `
    <div class="finding">
      <small>${escapeHtml(b.judgment.toUpperCase())}</small>
      <h3>Scope: ${escapeHtml(b.scope)}</h3>
      <p>${escapeHtml(b.detail || '')}</p>
      ${b.evidence_refs?.length ? `<p class="footnote">Evidence: ${escapeHtml(b.evidence_refs.join(', '))}</p>` : ''}
    </div>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>Capability boundaries</h2><span class="status info">task-typed</span></header>
  <div class="card-body">${items}</div>
</section>
`;
}

function htmlCaseConclusions(report) {
  if (!report.case_conclusions?.length) return '';
  const header = '<tr><th>Case</th><th>Decision</th><th>P0</th><th>Judgment</th><th>Scores (B/V/I/U)</th></tr>';
  const rows = report.case_conclusions.map(c => {
    const scores = c.scores
      ? `${scoreOrDash(c.scores.business)}/${scoreOrDash(c.scores.visual)}/${scoreOrDash(c.scores.interaction)}/${scoreOrDash(c.scores.usability)}`
      : '—';
    const p0Class = P0_STATUS_CLASS[c.p0_state] || 'info';
    return `<tr><td class="model">${escapeHtml(c.case_id)}</td><td>${escapeHtml(c.decision || '—')}</td><td class="score ${p0Class}">${escapeHtml(P0_LABEL[c.p0_state] || c.p0_state)}</td><td>${escapeHtml(c.judgment || '—')}</td><td>${escapeHtml(scores)}</td></tr>`;
  }).join('');
  const details = report.case_conclusions
    .filter(c => c.detail)
    .map(c => `<p class="footnote"><b>${escapeHtml(c.case_id)}:</b> ${escapeHtml(c.detail)}</p>`)
    .join('');
  return `<section class="card">
  <header class="card-head"><h2>Case conclusions</h2><span class="status info">${report.case_conclusions.length} case(s)</span></header>
  <div class="card-body">
    <table class="matrix"><thead>${header}</thead><tbody>${rows}</tbody></table>
    ${details}
  </div>
</section>
`;
}

function htmlFailureModes(report) {
  if (!report.failure_modes?.length) {
    return `<section class="card">
  <header class="card-head"><h2>Failure modes</h2><span class="status good">none recorded</span></header>
  <div class="card-body"><p class="muted">No failure modes recorded.</p></div>
</section>
`;
  }
  const items = report.failure_modes.map(f => `
    <div class="finding">
      <small>${escapeHtml(f.source.toUpperCase())}</small>
      <h3>${escapeHtml(f.title)}</h3>
      ${f.detail ? `<p>${escapeHtml(f.detail)}</p>` : ''}
      ${f.evidence_refs?.length ? `<p class="footnote">Evidence: ${escapeHtml(f.evidence_refs.join(', '))}</p>` : ''}
    </div>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>Failure modes</h2><span class="status warn">${report.failure_modes.length} recorded</span></header>
  <div class="card-body">${items}</div>
</section>
`;
}

function htmlRecommendedActions(report) {
  if (!report.recommended_actions?.length) return '';
  const items = report.recommended_actions.map(action => `
    <div class="finding">
      <small>${escapeHtml(action.priority.toUpperCase())}</small>
      <h3>${escapeHtml(action.title)}</h3>
      <p>${escapeHtml(action.rationale)}</p>
    </div>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>Recommended actions</h2><span class="status good">actionable</span></header>
  <div class="card-body">${items}</div>
</section>
`;
}

function htmlFactLayers(report) {
  if (!report.fact_layers) return '';
  const sections = [];
  for (const [layer, facts] of Object.entries(report.fact_layers)) {
    if (!facts?.length) continue;
    const items = facts.map(f => `<li><b>${escapeHtml(f.id)}</b> ${escapeHtml(f.statement)}${f.evidence_refs?.length ? ` <small>Evidence: ${escapeHtml(f.evidence_refs.join(', '))}</small>` : ''}</li>`).join('');
    sections.push(`<section class="card">
  <header class="card-head"><h2>${escapeHtml(labelForLayer(layer))}</h2><span class="status info">${facts.length} item(s)</span></header>
  <div class="card-body"><ul class="fact-list">${items}</ul></div>
</section>`);
  }
  return sections.join('');
}

function htmlEvidenceIndex(report) {
  if (!report.evidence_index?.length) return '';
  const rows = report.evidence_index.map(item => `<tr><td><code>${escapeHtml(item.handle)}</code></td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.label)}</td></tr>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>Evidence index</h2><span class="status info">${report.evidence_index.length} reference(s)</span></header>
  <div class="card-body"><table class="matrix"><thead><tr><th>Handle</th><th>Kind</th><th>Label</th></tr></thead><tbody>${rows}</tbody></table></div>
</section>
`;
}

function htmlDataProvenance(report) {
  if (!report.data_provenance) return '';
  const rows = report.data_provenance.inputs.map(input => `<tr><td>${escapeHtml(input.run_id)}</td><td>${escapeHtml(input.case_id)}</td><td>${escapeHtml(input.model_label)}</td><td>${yesNo(input.has_human_review)}</td><td>${yesNo(input.has_evaluator)}</td><td>${yesNo(input.accepted)}</td><td>${input.demo ? '<b>DEMO</b>' : 'no'}</td></tr>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>Data provenance</h2><span class="status ${report.data_provenance.demo_inputs_present ? 'warn' : 'good'}">${report.data_provenance.demo_inputs_present ? 'demo present' : 'no demo'}</span></header>
  <div class="card-body">
    <p class="footnote">Leaderboard eligible: <b>${report.data_provenance.leaderboard_eligible ? 'yes' : 'no'}</b></p>
    <table class="matrix"><thead><tr><th>Run</th><th>Case</th><th>Model</th><th>Review</th><th>Evaluator</th><th>Accepted</th><th>Demo</th></tr></thead><tbody>${rows}</tbody></table>
  </div>
</section>
`;
}

function htmlBodyEnd() {
  return `</main>
</body>
</html>
`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function labelForLayer(layer) {
  return {
    machine: 'Machine facts',
    human: 'Human observations',
    inferred: 'Computed inferences',
    unverified: 'Unverified claims',
  }[layer] || layer;
}

function formatMinutes(value) {
  if (value == null) return 'unavailable';
  if (value === 0) return '0 min';
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function formatMinutesShort(value) {
  if (value == null) return '—';
  if (value === 0) return '0';
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}h` : `${hours}.${String(Math.round((minutes / 60) * 10)).padStart(1, '0')}h`;
}

function formatSpeedup(speedup) {
  if (!speedup) return 'unavailable';
  if (!speedup.eligible || speedup.ratio == null) return 'not eligible until a delivery is accepted';
  return `${speedup.ratio}× (baseline ${formatMinutes(speedup.baseline_minutes)} / candidate ${formatMinutes(speedup.candidate_minutes)})`;
}

function formatSpeedupShort(speedup) {
  if (!speedup || !speedup.eligible || speedup.ratio == null) return 'n/a';
  return `${speedup.ratio}×`;
}

function formatRate(rate) {
  if (!rate || rate.percent == null) return 'unavailable';
  return `${rate.percent}% (${rate.accepted}/${rate.reviewed}) — source: ${rate.source}`;
}

function scoreOrDash(value) {
  return typeof value === 'number' ? String(value) : '—';
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

const STYLES = `
:root {
  --ink:#1c2520; --muted:#5a6a62; --faint:#8a9990;
  --panel:#f7f9f7; --panel-2:#eef2ee; --line:#d7ded7;
  --acid:#3a8a3a; --cyan:#0e7c9b; --amber:#a86800; --red:#a52a1a;
}
* { box-sizing: border-box; }
body {
  margin: 0; color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  background: #f3f6f3;
}
.shell { width: min(1100px, calc(100% - 32px)); margin: 0 auto; padding: 0 0 64px; }
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 0; border-bottom: 1px solid var(--line);
}
.brand { font-weight: 700; letter-spacing: .04em; }
.brand-mark {
  display: inline-block; padding: 4px 8px; margin-right: 10px;
  color: #fff; font-size: 11px; background: var(--acid);
}
.top-meta { color: var(--faint); font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
.demo-ribbon {
  margin: 18px 0 0; padding: 10px 14px; border: 1px solid #d8a85a;
  background: #fff5e1; color: #6a4500; font-size: 13px;
}
.demo-ribbon b { background: #f1b137; color: #1c1300; padding: 2px 6px; margin-right: 8px; }
.report-hero {
  display: grid; grid-template-columns: 1.4fr .6fr; gap: 20px;
  padding: 40px 0 24px;
}
.verdict { padding: 28px; border: 1px solid var(--line); background: var(--panel); }
.verdict h1 { margin: 14px 0 12px; font-size: 30px; line-height: 1.2; }
.verdict p { margin: 0; color: var(--muted); }
.speed-number { margin-top: 20px; }
.speed-number b { font-size: 38px; color: var(--acid); margin-right: 10px; }
.speed-number span { color: var(--muted); font-size: 12px; }
.decision-panel { padding: 22px; border: 1px solid var(--line); background: var(--panel); }
.decision-panel h2 { margin: 8px 0 14px; font-size: 18px; }
.decision-list { display: grid; gap: 10px; }
.decision-item { display: grid; grid-template-columns: 24px 1fr; gap: 8px; font-size: 13px; color: var(--muted); }
.decision-item b { width: 20px; height: 20px; display: grid; place-items: center; color: #fff; font-size: 11px; background: var(--acid); }
.eyebrow { color: var(--acid); font-family: ui-monospace, Menlo, monospace; font-size: 11px; text-transform: uppercase; }
.status {
  display: inline-block; padding: 4px 8px; border: 1px solid var(--line);
  color: var(--muted); font-size: 11px; text-transform: uppercase;
}
.status.good { color: var(--acid); border-color: var(--acid); }
.status.warn { color: var(--amber); border-color: var(--amber); }
.status.bad { color: var(--red); border-color: var(--red); }
.status.info { color: var(--cyan); border-color: var(--cyan); }
.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.metric { padding: 18px; border: 1px solid var(--line); background: var(--panel); }
.metric .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.metric .value { margin: 10px 0 4px; font-size: 28px; font-weight: 700; }
.metric .delta { color: var(--faint); font-size: 11px; }
.card { margin-top: 18px; border: 1px solid var(--line); background: var(--panel); }
.card-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.card-head h2 { margin: 0; font-size: 16px; }
.card-body { padding: 18px; }
.lead { margin: 0 0 14px; font-size: 14px; line-height: 1.6; }
.kv { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; }
.kv dt { color: var(--muted); font-size: 12px; }
.kv dd { margin: 0; font-size: 13px; }
.matrix { width: 100%; border-collapse: collapse; font-size: 13px; }
.matrix th { padding: 8px; text-align: left; color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); }
.matrix td { padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.matrix .model { font-weight: 700; }
.score { font-family: ui-monospace, Menlo, monospace; }
.score.good { color: var(--acid); }
.score.warn { color: var(--amber); }
.score.bad { color: var(--red); }
.bar-list { display: grid; gap: 12px; }
.bar-row { display: grid; grid-template-columns: 200px 1fr 80px; gap: 10px; align-items: center; font-size: 12px; color: var(--muted); }
.bar-track { height: 8px; background: #e3e9e3; }
.bar-fill { height: 100%; background: var(--cyan); }
.bar-fill.human { background: var(--acid); }
.bar-value { font-family: ui-monospace, Menlo, monospace; text-align: right; color: var(--ink); }
.finding { padding: 12px 0; border-bottom: 1px solid var(--line); }
.finding:last-child { border-bottom: 0; }
.finding small { color: var(--cyan); font-family: ui-monospace, Menlo, monospace; }
.finding h3 { margin: 6px 0; font-size: 14px; }
.finding p { margin: 0; color: var(--muted); font-size: 13px; }
.fact-list { margin: 0; padding-left: 18px; }
.fact-list li { margin-bottom: 6px; font-size: 13px; }
.fact-list small { color: var(--faint); }
.footnote { margin-top: 12px; color: var(--faint); font-size: 11px; }
.muted { color: var(--muted); font-size: 13px; }
@media (max-width: 900px) {
  .report-hero { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .metric-grid { grid-template-columns: 1fr; }
  .bar-row { grid-template-columns: 1fr; }
}
`;
