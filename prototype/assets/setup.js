const engineDefaults = {
  "codex-cli": {
    label: "Codex ready",
    status: "info",
    provider: "openai",
    model: "gpt-5-example",
    executable: "codex",
    credential: "secret://codex/default"
  },
  "kimi-code-cli": {
    label: "Kimi ready",
    status: "info",
    provider: "moonshot",
    model: "kimi-k3-example",
    executable: "/Users/leozhou/.kimi-code/bin/kimi",
    credential: "secret://kimi/default"
  },
  "claude-code-cli": {
    label: "Claude ready",
    status: "info",
    provider: "zhipu",
    model: "glm-example",
    executable: "claude",
    credential: "secret://claude-code/zhipu"
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function selectedCases() {
  return $$("#case-grid input:checked").map((input) => input.value);
}

function selectedEngine() {
  return $('input[name="engine"]:checked').value;
}

function refreshCards() {
  $$(".select-card input").forEach((input) => {
    input.closest(".select-card").classList.toggle("selected", input.checked);
  });

  const cases = selectedCases();
  $("#case-status").textContent = `${cases.length} selected`;
  $("#case-status").className = `status ${cases.length ? "good" : "bad"}`;

  const engine = selectedEngine();
  const meta = engineDefaults[engine];
  const engineStatus = $("#engine-status");
  engineStatus.textContent = meta.label;
  engineStatus.className = `status ${meta.status}`;

  $("#run-summary").innerHTML =
    `<b>${cases.length} Case${cases.length === 1 ? "" : "s"}</b> · ${engine} / ${$("#model").value || "model unset"} · file-isolated development · public network ${$("#network").checked ? "enabled" : "disabled"}`;
}

function applyEngineDefaults() {
  const meta = engineDefaults[selectedEngine()];
  $("#provider").value = meta.provider;
  $("#model").value = meta.model;
  $("#executable").value = meta.executable;
  $("#credential").value = meta.credential;
  refreshCards();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

$$("input, select").forEach((element) => {
  element.addEventListener("change", () => {
    if (element.name === "engine") applyEngineDefaults();
    else refreshCards();
  });
  element.addEventListener("input", refreshCards);
});

$("#generate-run").addEventListener("click", () => {
  const cases = selectedCases();
  if (!cases.length) {
    showToast("至少选择一个 Case。");
    return;
  }

  const engine = selectedEngine();
  showToast(`RunSpec 预览已生成：${cases.length} Cases / ${engine}`);
});

refreshCards();
