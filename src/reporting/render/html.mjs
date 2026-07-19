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
  passed: 'P0 已通过',
  partial: 'P0 部分通过',
  failed: 'P0 未通过',
  unknown: 'P0 待评审',
};

const VERDICT_LABEL = {
  'replaceable-delivery': '可替代交付',
  'high-value-assist': '高价值辅助',
  'limited-assist': '有限辅助',
  'not-applicable': '暂不适用',
};

export function renderHtml(report) {
  validateReportShape(report);
  const title = escapeHtml(report.title || `评测报告 ${report.report_id}`);
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
<html lang="zh-CN">
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
    ? `<div class="demo-ribbon"><b>演示数据</b> 至少一个输入运行被标记为 DEMO，不得将以下数据计入正式排行榜。</div>`
    : '';
  const verdict = report.leadership_summary?.verdict;
  const verdictClass = VERDICT_STATUS_CLASS[verdict] || 'info';
  const verdictLabel = verdict ? (VERDICT_LABEL[verdict] || verdict) : '暂无综合判断';
  const evidenceStatus = report.evidence_completeness?.percent === 100 ? 'good' : (report.evidence_completeness?.percent >= 50 ? 'warn' : 'bad');
  return `<main class="shell">
<header class="topbar">
  <div class="brand"><span class="brand-mark">VAB</span>可视化 Agent 评测报告</div>
  <div class="top-meta">报告 / ${escapeHtml(report.report_id)} / ${escapeHtml(report.generated_at)}</div>
</header>
${demoBanner}
<section class="report-hero">
  <div class="verdict">
    <span class="status ${verdictClass}">综合判断：${escapeHtml(verdictLabel)}</span>
    <h1>${escapeHtml(report.leadership_summary?.headline || title)}</h1>
    <p>视图：${escapeHtml(report.view?.kind || '未知')} · ${report.view?.scope?.run_ids?.length ?? 0} 次运行 · 证据完整度 ${report.evidence_completeness?.percent ?? 0}%。</p>
    <div class="speed-number"><b>${formatSpeedupShort(report.leadership_summary?.effective_speedup)}</b><span>有效提效倍数 · ${report.leadership_summary?.effective_speedup?.eligible ? '仅统计已验收交付' : '验收后才可计算'}</span></div>
  </div>
  <aside class="decision-panel">
    <div>
      <div class="eyebrow">管理摘要</div>
      <h2>这份报告回答什么</h2>
      <div class="decision-list">
        <div class="decision-item"><b>1</b><span>${escapeHtml(report.leadership_summary?.accepted_delivery_rate?.source === 'human-review' ? `可验收交付率 ${report.leadership_summary.accepted_delivery_rate.percent}%。` : '人工评审完成前无法计算可验收交付率。')}</span></div>
        <div class="decision-item"><b>2</b><span>有效提效倍数只基于已验收交付计算。</span></div>
        <div class="decision-item"><b>3</b><span>${report.view?.demo ? '包含 DEMO 输入——本报告不得进入正式排行榜。' : '本报告未检测到 DEMO 输入。'}</span></div>
      </div>
    </div>
    <span class="status ${evidenceStatus}">证据完整度 ${report.evidence_completeness?.percent ?? 0}%</span>
  </aside>
</section>
`;
}

function htmlLeadership(report) {
  const summary = report.leadership_summary;
  return `<section class="card">
  <header class="card-head"><h2>管理结论</h2><span class="status info">决策输入</span></header>
  <div class="card-body">
    <p class="lead">${escapeHtml(summary?.headline || '')}</p>
    <dl class="kv">
      <dt>综合判断</dt><dd>${escapeHtml(VERDICT_LABEL[summary?.verdict] || summary?.verdict || '暂无')}</dd>
      <dt>有效提效倍数</dt><dd>${escapeHtml(formatSpeedup(summary?.effective_speedup))}</dd>
      <dt>可验收交付率</dt><dd>${escapeHtml(formatRate(summary?.accepted_delivery_rate))}</dd>
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
  <div class="metric"><div class="label">有效提效倍数</div><div class="value">${formatSpeedupShort(summary?.effective_speedup)}</div><div class="delta">${summary?.effective_speedup?.eligible ? '仅统计已验收运行' : '暂不可计算'}</div></div>
  <div class="metric"><div class="label">可验收交付率</div><div class="value">${acceptedPercent == null ? '—' : acceptedPercent + '%'}</div><div class="delta">已评审 ${summary?.accepted_delivery_rate?.accepted ?? 0}/${summary?.accepted_delivery_rate?.reviewed ?? 0}</div></div>
  <div class="metric"><div class="label">人工介入时间</div><div class="value">${formatMinutesShort(totalMinutes)}</div><div class="delta">来源：${escapeHtml(labelForEnum(ht?.source) || '暂无')}</div></div>
  <div class="metric"><div class="label">证据完整度</div><div class="value">${report.evidence_completeness?.percent ?? 0}%</div><div class="delta">${report.evidence_completeness?.missing?.length ? '缺失：' + escapeHtml(report.evidence_completeness.missing.join(', ')) : '所需证据齐全'}</div></div>
</section>
`;
}

function htmlHumanTouch(report) {
  const ht = report.human_touch_breakdown;
  if (!ht || ht.source === 'unavailable') {
    return `<section class="card">
  <header class="card-head"><h2>人工介入时间</h2><span class="status bad">暂无</span></header>
  <div class="card-body"><p class="muted">尚无已完成的人工评审，无法计算人工介入时间。</p></div>
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
    ? '<p class="footnote">数据不完整：部分运行缺少人工评审，合计值可能偏低。</p>'
    : '';
  return `<section class="card">
  <header class="card-head"><h2>人工介入时间</h2><span class="status info">分环节统计</span></header>
  <div class="card-body bar-list">
    ${rows}
    <div class="bar-row"><span><b>合计</b></span><div class="bar-track"></div><span class="bar-value"><b>${escapeHtml(formatMinutes(ht.total_minutes))}</b></span></div>
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
    ? `输入 ${cost.reported_tokens.input_tokens.toLocaleString()} · 输出 ${cost.reported_tokens.output_tokens.toLocaleString()} · 缓存读取 ${cost.reported_tokens.cached_tokens.toLocaleString()}`
    : '暂无';
  const costText = cost.reported_cost_usd == null ? '暂无' : `$${cost.reported_cost_usd.toFixed(4)}`;
  return `<section class="card">
  <header class="card-head"><h2>费用与 Token</h2><span class="status ${availabilityClass}">${escapeHtml(labelForEnum(cost.availability))}</span></header>
  <div class="card-body">
    <dl class="kv">
      <dt>已上报美元费用</dt><dd>${escapeHtml(costText)}</dd>
      <dt>已上报 Token</dt><dd>${escapeHtml(tokenText)}</dd>
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
      <h3>适用范围：${escapeHtml(b.scope)}</h3>
      <p>${escapeHtml(b.detail || '')}</p>
      ${b.evidence_refs?.length ? `<p class="footnote">证据：${escapeHtml(b.evidence_refs.join(', '))}</p>` : ''}
    </div>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>能力边界</h2><span class="status info">按任务分类</span></header>
  <div class="card-body">${items}</div>
</section>
`;
}

function htmlCaseConclusions(report) {
  if (!report.case_conclusions?.length) return '';
  const header = '<tr><th>Case</th><th>人工决策</th><th>P0</th><th>能力判断</th><th>得分（业务/视觉/交互/可用性）</th></tr>';
  const rows = report.case_conclusions.map(c => {
    const scores = c.scores
      ? `${scoreOrDash(c.scores.business)}/${scoreOrDash(c.scores.visual)}/${scoreOrDash(c.scores.interaction)}/${scoreOrDash(c.scores.usability)}`
      : '—';
    const p0Class = P0_STATUS_CLASS[c.p0_state] || 'info';
    return `<tr><td class="model">${escapeHtml(c.case_id)}</td><td>${escapeHtml(labelForEnum(c.decision) || '—')}</td><td class="score ${p0Class}">${escapeHtml(P0_LABEL[c.p0_state] || c.p0_state)}</td><td>${escapeHtml(VERDICT_LABEL[c.judgment] || labelForEnum(c.judgment) || '—')}</td><td>${escapeHtml(scores)}</td></tr>`;
  }).join('');
  const details = report.case_conclusions
    .filter(c => c.detail)
    .map(c => `<p class="footnote"><b>${escapeHtml(c.case_id)}:</b> ${escapeHtml(c.detail)}</p>`)
    .join('');
  return `<section class="card">
  <header class="card-head"><h2>Case 结论</h2><span class="status info">${report.case_conclusions.length} 个 Case</span></header>
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
  <header class="card-head"><h2>失败模式</h2><span class="status good">无记录</span></header>
  <div class="card-body"><p class="muted">未记录失败模式。</p></div>
</section>
`;
  }
  const items = report.failure_modes.map(f => `
    <div class="finding">
      <small>${escapeHtml(labelForEnum(f.source))}</small>
      <h3>${escapeHtml(f.title)}</h3>
      ${f.detail ? `<p>${escapeHtml(f.detail)}</p>` : ''}
      ${f.evidence_refs?.length ? `<p class="footnote">证据：${escapeHtml(f.evidence_refs.join(', '))}</p>` : ''}
    </div>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>失败模式</h2><span class="status warn">${report.failure_modes.length} 条</span></header>
  <div class="card-body">${items}</div>
</section>
`;
}

function htmlRecommendedActions(report) {
  if (!report.recommended_actions?.length) return '';
  const items = report.recommended_actions.map(action => `
    <div class="finding">
      <small>${escapeHtml(labelForEnum(action.priority))}</small>
      <h3>${escapeHtml(action.title)}</h3>
      <p>${escapeHtml(action.rationale)}</p>
    </div>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>建议动作</h2><span class="status good">可执行</span></header>
  <div class="card-body">${items}</div>
</section>
`;
}

function htmlFactLayers(report) {
  if (!report.fact_layers) return '';
  const sections = [];
  for (const [layer, facts] of Object.entries(report.fact_layers)) {
    if (!facts?.length) continue;
    const items = facts.map(f => `<li><b>${escapeHtml(f.id)}</b> ${escapeHtml(f.statement)}${f.evidence_refs?.length ? ` <small>证据：${escapeHtml(f.evidence_refs.join(', '))}</small>` : ''}</li>`).join('');
    sections.push(`<section class="card">
  <header class="card-head"><h2>${escapeHtml(labelForLayer(layer))}</h2><span class="status info">${facts.length} 条</span></header>
  <div class="card-body"><ul class="fact-list">${items}</ul></div>
</section>`);
  }
  return sections.join('');
}

function htmlEvidenceIndex(report) {
  if (!report.evidence_index?.length) return '';
  const rows = report.evidence_index.map(item => `<tr><td><code>${escapeHtml(item.handle)}</code></td><td>${escapeHtml(labelForEnum(item.kind))}</td><td>${escapeHtml(item.label)}</td></tr>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>证据索引</h2><span class="status info">${report.evidence_index.length} 个引用</span></header>
  <div class="card-body"><table class="matrix"><thead><tr><th>引用标识</th><th>类型</th><th>名称</th></tr></thead><tbody>${rows}</tbody></table></div>
</section>
`;
}

function htmlDataProvenance(report) {
  if (!report.data_provenance) return '';
  const rows = report.data_provenance.inputs.map(input => `<tr><td>${escapeHtml(input.run_id)}</td><td>${escapeHtml(input.case_id)}</td><td>${escapeHtml(input.model_label)}</td><td>${yesNo(input.has_human_review)}</td><td>${yesNo(input.has_evaluator)}</td><td>${yesNo(input.accepted)}</td><td>${input.demo ? '<b>DEMO</b>' : '否'}</td></tr>`).join('');
  return `<section class="card">
  <header class="card-head"><h2>数据来源</h2><span class="status ${report.data_provenance.demo_inputs_present ? 'warn' : 'good'}">${report.data_provenance.demo_inputs_present ? '包含演示数据' : '无演示数据'}</span></header>
  <div class="card-body">
    <p class="footnote">可计入排行榜：<b>${report.data_provenance.leaderboard_eligible ? '是' : '否'}</b></p>
    <table class="matrix"><thead><tr><th>运行</th><th>Case</th><th>模型</th><th>人工评审</th><th>自动评估</th><th>已验收</th><th>演示</th></tr></thead><tbody>${rows}</tbody></table>
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
    clarification_minutes: '需求澄清',
    context_prep_minutes: '上下文与规格准备',
    poc_review_minutes: 'POC 评审',
    micro_adjustment_minutes: '视觉与交互微调',
    fix_minutes: '缺陷与回归修复',
    final_review_minutes: '最终验收',
  }[key] || key;
}

function labelForLayer(layer) {
  return {
    machine: '机器事实',
    human: '人工观察',
    inferred: '计算推断',
    unverified: '未验证陈述',
  }[layer] || layer;
}

function formatMinutes(value) {
  if (value == null) return '暂无';
  if (value === 0) return '0 分钟';
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function formatMinutesShort(value) {
  if (value == null) return '—';
  if (value === 0) return '0';
  if (value < 60) return `${value}分`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}小时` : `${hours}.${String(Math.round((minutes / 60) * 10)).padStart(1, '0')}小时`;
}

function formatSpeedup(speedup) {
  if (!speedup) return '暂无';
  if (!speedup.eligible || speedup.ratio == null) return '交付验收前暂不可计算';
  return `${speedup.ratio}×（人工基线 ${formatMinutes(speedup.baseline_minutes)} / AI 协作 ${formatMinutes(speedup.candidate_minutes)}）`;
}

function formatSpeedupShort(speedup) {
  if (!speedup || !speedup.eligible || speedup.ratio == null) return '待评估';
  return `${speedup.ratio}×`;
}

function formatRate(rate) {
  if (!rate || rate.percent == null) return '暂无';
  return `${rate.percent}%（${rate.accepted}/${rate.reviewed}）— 来源：${rate.source}`;
}

function scoreOrDash(value) {
  return typeof value === 'number' ? String(value) : '—';
}

function yesNo(value) {
  return value ? '是' : '否';
}

function labelForEnum(value) {
  return {
    accepted: '已验收',
    'accepted-with-fixes': '修复后验收',
    partial: '部分',
    rejected: '拒绝验收',
    'invalid-run': '无效运行',
    unavailable: '暂无',
    reported: '已上报',
    'human-review': '人工评审',
    machine: '机器',
    human: '人工',
    inferred: '推断',
    unverified: '未验证',
    now: '立即',
    next: '下一步',
    watch: '持续观察',
    run: '运行',
    evaluator: '自动评估',
    isolation: '隔离信息',
    browser: '浏览器证据',
  }[value] || value;
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
