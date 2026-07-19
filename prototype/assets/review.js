const cases = [
  { id: "macro-map-3d-greenfield", title: "Macro Map 3D", machine: "等待接入真实机器证据" },
  { id: "narrative-equity-relationship", title: "股权关系叙事可视化", machine: "等待接入真实机器证据" },
  { id: "ainvest-market-heatmap-rebuild", title: "Market Heatmap", machine: "等待接入真实机器证据" }
];

const storageKey = "vis-agent-bench-human-review-v2";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function scoreOptions() {
  return '<option value="">未评</option>' +
    [1, 2, 3, 4, 5].map(value => `<option value="${value}">${value} / 5</option>`).join("");
}

function caseTemplate(item) {
  return `
    <article class="review-case" data-case="${item.id}">
      <header class="review-case-head">
        <div><h2>${item.title}</h2><p>${item.id} · ${item.machine}</p></div>
        <span class="status warn case-review-status">pending</span>
      </header>
      <div class="review-form">
        <div class="score-grid">
          ${["business:业务正确性", "visual:视觉质量", "interaction:交互完整性", "usability:可用与维护"].map(entry => {
            const [key, label] = entry.split(":");
            return `<div class="score-field"><label>${label}</label><select data-field="${key}">${scoreOptions()}</select></div>`;
          }).join("")}
        </div>
        <div class="review-time-grid">
          <div class="field"><label>需求澄清分钟</label><input type="number" min="0" value="0" data-field="clarification_minutes"></div>
          <div class="field"><label>上下文/Spec 准备分钟</label><input type="number" min="0" value="0" data-field="context_prep_minutes"></div>
          <div class="field"><label>首版 POC 评审分钟</label><input type="number" min="0" value="0" data-field="poc_review_minutes"></div>
          <div class="field"><label>视觉交互微调分钟</label><input type="number" min="0" value="0" data-field="micro_adjustment_minutes"></div>
          <div class="field"><label>缺陷/回归修复分钟</label><input type="number" min="0" value="0" data-field="fix_minutes"></div>
          <div class="field"><label>最终验收分钟</label><input type="number" min="0" value="0" data-field="final_review_minutes"></div>
        </div>
        <div class="review-time-grid">
          <div class="field"><label>澄清轮数</label><input type="number" min="0" value="0" data-field="clarification_rounds"></div>
          <div class="field"><label>验收前迭代轮数</label><input type="number" min="0" value="0" data-field="iterations_to_acceptance"></div>
          <div class="field"><label>微调项数</label><input type="number" min="0" value="0" data-field="micro_adjustment_items"></div>
          <div class="field"><label>Must 遗漏数</label><input type="number" min="0" value="0" data-field="must_have_misses"></div>
          <div class="field"><label>已满足要求回归数</label><input type="number" min="0" value="0" data-field="requirement_regressions"></div>
          <div class="field"><label>首版 POC 最终要求覆盖率</label><input type="number" min="0" max="100" value="0" data-field="first_poc_fitness_percent"></div>
          <div class="field"><label>最终判断</label><select data-field="decision">
            <option value="">请选择</option>
            <option value="accepted">可直接接受</option>
            <option value="accepted-with-fixes">小修后接受</option>
            <option value="partial">只能部分辅助</option>
            <option value="rejected">不可接受</option>
            <option value="invalid-run">运行无效</option>
          </select></div>
        </div>
        <div class="review-text-grid">
          <div class="field"><label>做得好的地方</label><textarea data-field="strengths" placeholder="结合截图、交互和代码证据填写"></textarea></div>
          <div class="field"><label>主要问题</label><textarea data-field="problems" placeholder="哪些地方不符合业务或视觉预期"></textarea></div>
          <div class="field"><label>必须人工修改</label><textarea data-field="required_fixes" placeholder="如果交付，还需要修改什么"></textarea></div>
          <div class="field"><label>管理判断</label><textarea data-field="management_judgment" placeholder="替代交付 / 高价值辅助 / 有限辅助 / 暂不适用"></textarea></div>
        </div>
      </div>
    </article>`;
}

$("#review-cases").innerHTML = cases.map(caseTemplate).join("");

function readCase(article) {
  const value = field => article.querySelector(`[data-field="${field}"]`).value;
  const integer = field => Number(value(field) || 0);
  const scores = ["business", "visual", "interaction", "usability"];
  const complete = scores.every(key => integer(key) > 0) && value("decision");
  return {
    case_id: article.dataset.case,
    complete: Boolean(complete),
    decision: value("decision") || null,
    scores: Object.fromEntries(scores.map(key => [key, integer(key) || null])),
    human_time: {
      clarification_minutes: integer("clarification_minutes"),
      context_prep_minutes: integer("context_prep_minutes"),
      poc_review_minutes: integer("poc_review_minutes"),
      micro_adjustment_minutes: integer("micro_adjustment_minutes"),
      fix_minutes: integer("fix_minutes"),
      final_review_minutes: integer("final_review_minutes")
    },
    convergence: {
      clarification_rounds: integer("clarification_rounds"),
      iterations_to_acceptance: integer("iterations_to_acceptance"),
      micro_adjustment_items: integer("micro_adjustment_items"),
      must_have_misses: integer("must_have_misses"),
      requirement_regressions: integer("requirement_regressions"),
      first_poc_fitness_percent: integer("first_poc_fitness_percent")
    },
    observations: {
      strengths: value("strengths"),
      problems: value("problems"),
      required_fixes: value("required_fixes"),
      management_judgment: value("management_judgment")
    }
  };
}

function packageData() {
  return {
    schema_version: 2,
    run_id: $("#run-id").value,
    reviewer: $("#reviewer").value,
    isolation: "file-isolated-development",
    reviews: $$(".review-case").map(readCase),
    reviewed_at: new Date().toISOString()
  };
}

function refresh() {
  const data = packageData();
  let completed = 0;
  $$(".review-case").forEach(article => {
    const review = readCase(article);
    const status = article.querySelector(".case-review-status");
    status.textContent = review.complete ? "reviewed" : "pending";
    status.className = `status ${review.complete ? "good" : "warn"} case-review-status`;
    if (review.complete) completed += 1;
  });
  $("#review-progress").textContent = `${completed} / ${cases.length} reviewed`;
  $("#review-progress").className = `status ${completed === cases.length ? "good" : "warn"}`;
  $("#review-preview").textContent = JSON.stringify(data, null, 2);
  return data;
}

function restore() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return;
  const data = JSON.parse(saved);
  $("#run-id").value = data.run_id || "";
  $("#reviewer").value = data.reviewer || "";
  for (const review of data.reviews || []) {
    const article = document.querySelector(`[data-case="${review.case_id}"]`);
    if (!article) continue;
    for (const [key, value] of Object.entries(review.scores || {})) {
      article.querySelector(`[data-field="${key}"]`).value = value || "";
    }
    for (const [key, value] of Object.entries(review.human_time || {})) {
      article.querySelector(`[data-field="${key}"]`).value = value ?? 0;
    }
    for (const [key, value] of Object.entries(review.convergence || {})) {
      article.querySelector(`[data-field="${key}"]`).value = value ?? 0;
    }
    for (const [key, value] of Object.entries(review.observations || {})) {
      article.querySelector(`[data-field="${key}"]`).value = value || "";
    }
    article.querySelector('[data-field="decision"]').value = review.decision || "";
  }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2400);
}

document.addEventListener("input", refresh);
document.addEventListener("change", refresh);

$("#save-review").addEventListener("click", () => {
  const data = refresh();
  localStorage.setItem(storageKey, JSON.stringify(data));
  const completed = data.reviews.filter(review => review.complete).length;
  toast(`已保存 ${completed}/${cases.length} 个评审；真实 Runner 接入后再合并生成报告。`);
});

$("#clear-review").addEventListener("click", () => {
  localStorage.removeItem(storageKey);
  location.reload();
});

$("#export-review").addEventListener("click", () => {
  const data = refresh();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${data.run_id || "human-review"}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("人工评审 JSON 已导出。");
});

restore();
refresh();
