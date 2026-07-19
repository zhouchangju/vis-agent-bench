// Markdown renderer for the VAB-T07 report.
//
// Input: a JSON report that conforms to schemas/report.schema.json.
// Output: a Markdown string suitable for review in the repo and pasting into
// leadership updates. The renderer never fetches additional files; it only
// formats the structured report it was given.

const VERDICT_LABEL = {
  'replaceable-delivery': '可替代交付',
  'high-value-assist': '高价值辅助',
  'limited-assist': '有限辅助',
  'not-applicable': '暂不适用',
};

const JUDGMENT_LABEL = {
  'replaceable-delivery': '可替代交付',
  'high-value-assist': '高价值辅助',
  'limited-assist': '有限辅助',
  'not-applicable': '暂不适用',
  'unknown': '未知',
};

const P0_LABEL = {
  passed: 'P0 已通过',
  partial: 'P0 部分通过',
  failed: 'P0 未通过',
  unknown: 'P0 待评审',
};

const FACT_LAYER_LABEL = {
  machine: '机器事实',
  human: '人工观察',
  inferred: '计算推断',
  unverified: '未验证陈述',
};

export function renderMarkdown(report) {
  validateReportShape(report);
  const lines = [];
  const title = report.title || `评测报告 ${report.report_id}`;
  lines.push(`# ${title}`);
  lines.push('');
  if (report.view?.demo) {
    lines.push('> ⚠️ **演示数据** — 至少一个输入运行被标记为 DEMO，以下数据不得计入正式排行榜。');
    lines.push('');
  }
  lines.push(`- 报告 ID：\`${report.report_id}\``);
  lines.push(`- 生成时间：${report.generated_at}`);
  lines.push(`- 视图：${report.view?.kind}（运行数：${report.view?.scope?.run_ids?.length ?? 0}）`);
  lines.push(`- 证据完整度：${report.evidence_completeness.percent}%`);
  if (report.evidence_completeness.missing.length) {
    lines.push(`- 缺失证据：${report.evidence_completeness.missing.join(', ')}`);
  }
  lines.push('');

  lines.push('## 管理结论');
  lines.push('');
  const summary = report.leadership_summary;
  lines.push(`**综合判断：** ${summary.verdict ? VERDICT_LABEL[summary.verdict] || summary.verdict : '暂无'}`);
  lines.push('');
  lines.push(summary.headline);
  lines.push('');
  lines.push('| 指标 | 数值 | 说明 |');
  lines.push('| --- | --- | --- |');
  lines.push(`| 有效提效倍数 | ${formatSpeedup(summary.effective_speedup)} | ${summary.effective_speedup.eligible ? '仅统计已验收运行' : '至少一个运行验收后才可计算'} |`);
  lines.push(`| 可验收交付率 | ${formatRate(summary.accepted_delivery_rate)} | 来源：${labelForEnum(summary.accepted_delivery_rate.source)} |`);
  lines.push('');

  lines.push('## 人工介入时间');
  lines.push('');
  const ht = report.human_touch_breakdown;
  if (ht.source === 'unavailable') {
    lines.push('_尚无已完成的人工评审，无法计算人工介入时间。_');
  } else {
    lines.push('| 环节 | 分钟 |');
    lines.push('| --- | --- |');
    for (const [key, value] of Object.entries(ht)) {
      if (key === 'source' || key === 'total_minutes') continue;
      lines.push(`| ${labelForBucket(key)} | ${formatMinutes(value)} |`);
    }
    lines.push(`| **合计** | ${formatMinutes(ht.total_minutes)} |`);
    if (ht.source === 'partial') {
      lines.push('');
      lines.push('_数据不完整：部分运行缺少人工评审，合计值可能偏低。_');
    }
  }
  lines.push('');

  if (report.cost_summary) {
    lines.push('## 费用与 Token');
    lines.push('');
    const cost = report.cost_summary;
    lines.push(`- 数据状态：${labelForEnum(cost.availability)}`);
    lines.push(`- 已上报美元费用：${cost.reported_cost_usd == null ? '暂无' : `$${cost.reported_cost_usd.toFixed(4)}`}`);
    if (cost.reported_tokens) {
      lines.push(`- 已上报 Token：输入 ${cost.reported_tokens.input_tokens}，输出 ${cost.reported_tokens.output_tokens}，缓存读取 ${cost.reported_tokens.cached_tokens}`);
    } else {
      lines.push('- 已上报 Token：暂无');
    }
    lines.push(`- ${cost.currency_note}`);
    lines.push('');
  }

  if (report.capability_boundaries?.length) {
    lines.push('## 能力边界');
    lines.push('');
    for (const boundary of report.capability_boundaries) {
      lines.push(`### ${JUDGMENT_LABEL[boundary.judgment] || boundary.judgment}`);
      lines.push('');
      lines.push(`适用范围：${boundary.scope}`);
      lines.push('');
      lines.push(boundary.detail);
      lines.push('');
      if (boundary.evidence_refs?.length) {
        lines.push(`证据：${boundary.evidence_refs.join(', ')}`);
        lines.push('');
      }
    }
  }

  if (report.case_conclusions?.length) {
    lines.push('## Case 结论');
    lines.push('');
    lines.push('| Case | 人工决策 | P0 | 能力判断 | 得分（业务/视觉/交互/可用性） |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const conclusion of report.case_conclusions) {
      const scores = conclusion.scores
        ? `${scoreOrDash(conclusion.scores.business)}/${scoreOrDash(conclusion.scores.visual)}/${scoreOrDash(conclusion.scores.interaction)}/${scoreOrDash(conclusion.scores.usability)}`
        : '—';
      lines.push(`| ${conclusion.case_id} | ${labelForEnum(conclusion.decision) || '—'} | ${P0_LABEL[conclusion.p0_state]} | ${JUDGMENT_LABEL[conclusion.judgment] || conclusion.judgment} | ${scores} |`);
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
    lines.push('## 失败模式');
    lines.push('');
    for (const failure of report.failure_modes) {
      lines.push(`- **${failure.title}** _(${labelForEnum(failure.source)})_`);
      if (failure.detail) lines.push(`  - ${failure.detail}`);
      if (failure.evidence_refs?.length) lines.push(`  - 证据：${failure.evidence_refs.join(', ')}`);
    }
    lines.push('');
  } else {
    lines.push('## 失败模式');
    lines.push('');
    lines.push('_未记录失败模式。_');
    lines.push('');
  }

  if (report.recommended_actions?.length) {
    lines.push('## 建议动作');
    lines.push('');
    for (const action of report.recommended_actions) {
      lines.push(`- **[${labelForEnum(action.priority)}]** ${action.title}`);
      lines.push(`  - ${action.rationale}`);
    }
    lines.push('');
  }

  lines.push('## 事实分层');
  lines.push('');
  for (const [layer, facts] of Object.entries(report.fact_layers || {})) {
    if (!facts?.length) continue;
    lines.push(`### ${FACT_LAYER_LABEL[layer] || layer}`);
    lines.push('');
    for (const fact of facts) {
      lines.push(`- \`${fact.id}\` ${fact.statement}`);
      if (fact.evidence_refs?.length) lines.push(`  - 证据：${fact.evidence_refs.join(', ')}`);
    }
    lines.push('');
  }

  if (report.evidence_index?.length) {
    lines.push('## 证据索引');
    lines.push('');
    lines.push('| 引用标识 | 类型 | 名称 |');
    lines.push('| --- | --- | --- |');
    for (const item of report.evidence_index) {
      lines.push(`| \`${item.handle}\` | ${labelForEnum(item.kind)} | ${item.label} |`);
    }
    lines.push('');
  }

  lines.push('## 数据来源');
  lines.push('');
  lines.push(`- 包含演示输入：${report.data_provenance.demo_inputs_present ? '是' : '否'}`);
  lines.push(`- 可计入排行榜：${report.data_provenance.leaderboard_eligible ? '是' : '否'}`);
  lines.push('');
  lines.push('| 运行 | Case | 模型 | 人工评审 | 自动评估 | 已验收 | 演示 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const input of report.data_provenance.inputs) {
    lines.push(`| ${input.run_id} | ${input.case_id} | ${input.model_label} | ${input.has_human_review ? '是' : '否'} | ${input.has_evaluator ? '是' : '否'} | ${input.accepted ? '是' : '否'} | ${input.demo ? '是' : '否'} |`);
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
    clarification_minutes: '需求澄清',
    context_prep_minutes: '上下文与规格准备',
    poc_review_minutes: 'POC 评审',
    micro_adjustment_minutes: '视觉与交互微调',
    fix_minutes: '缺陷与回归修复',
    final_review_minutes: '最终验收',
  }[key] || key;
}

function formatMinutes(value) {
  if (value == null) return '暂无';
  if (value === 0) return '0';
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function formatSpeedup(speedup) {
  if (!speedup) return '暂无';
  if (!speedup.eligible || speedup.ratio == null) return '暂不可计算';
  return `${speedup.ratio}×（人工基线 ${formatMinutes(speedup.baseline_minutes)} / AI 协作 ${formatMinutes(speedup.candidate_minutes)}）`;
}

function formatRate(rate) {
  if (!rate || rate.percent == null) return '暂无';
  return `${rate.percent}% (${rate.accepted}/${rate.reviewed})`;
}

function scoreOrDash(value) {
  return typeof value === 'number' ? String(value) : '—';
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
