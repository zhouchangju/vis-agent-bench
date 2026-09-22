const engineDefaults = {
  "codex-cli": {
    label: "Codex ready",
    status: "info",
    provider: "openai",
    model: "gpt-5.6",
    modelProfiles: [
      { id: "gpt-5.6", label: "gpt-5.6 · medium", reasoningEffort: "medium" },
      { id: "gpt-5.6-sol", label: "gpt-5.6-sol · medium", reasoningEffort: "medium" },
      { id: "gpt-5.6-luna", label: "gpt-5.6-luna · xhigh（最大）", reasoningEffort: "xhigh" },
      { id: "gpt-5.6-luna-max", label: "gpt-5.6-luna · max", reasoningEffort: "max" },
      { id: "gpt-6-astra", label: "gpt-6-astra · low", reasoningEffort: "low" }
    ],
    executable: "codex",
    credential: "secret://codex/default"
  },
  "kimi-code-cli": {
    label: "Kimi ready",
    status: "info",
    provider: "moonshot",
    model: "kimi-code/k3",
    modelProfiles: [
      { id: "kimi-code/k3", label: "kimi-code/k3" }
    ],
    executable: "/Users/leozhou/.kimi-code/bin/kimi",
    credential: "secret://kimi/default"
  },
  "claude-code-cli": {
    label: "Claude ready",
    status: "info",
    provider: "zhipu",
    model: "glm-example",
    modelProfiles: [
      { id: "glm-example", label: "glm-example" }
    ],
    executable: "claude",
    credential: "secret://claude-code/zhipu"
  },
  "pi-cli": {
    label: "Pi ready",
    status: "info",
    provider: "pi-direct-api",
    modelProvider: "deepseek",
    model: "deepseek-chat",
    modelProfiles: [
      { id: "deepseek-chat", label: "deepseek-chat" }
    ],
    executable: "pi",
    credential: "secret://pi/deepseek"
  },
  "opencode-cli": {
    label: "OpenCode ready",
    status: "info",
    provider: "opencode-go",
    model: "opencode-go/deepseek-v4.1-flash",
    modelProfiles: [
      { id: "opencode-go/deepseek-v4.1-flash", label: "deepseek-v4.1-flash · high", reasoningEffort: "high" },
      { id: "opencode/mimo-v2.6-flash-free", label: "mimo-v2.6-flash-free · high", reasoningEffort: "high" },
      { id: "opencode/muse-spark-1.3-contributor-free", label: "muse-spark-1.3-contributor-free · high", reasoningEffort: "high" },
      { id: "zai-coding-plan/glm-5.3", label: "z.ai coding plan: glm-5.3 · high", reasoningEffort: "high" },
      { id: "zai-coding-plan/glm-5.3-flash", label: "z.ai coding plan: glm-5.3-flash · high", reasoningEffort: "high" }
    ],
    executable: "opencode",
    credential: "secret://opencode/default"
  }
};

const CUSTOM_MODEL_PROFILE = "__custom__";

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

  // Model ID is free-typed user input; render it via textContent so it can
  // never be interpreted as markup.
  const summary = $("#run-summary");
  const bold = document.createElement("b");
  bold.textContent = `${cases.length} Case${cases.length === 1 ? "" : "s"}`;
  summary.replaceChildren(
    bold,
    document.createTextNode(
      ` · ${engine} / ${$("#model").value || "model unset"} · file-isolated development · public network ${$("#network").checked ? "enabled" : "disabled"}`,
    ),
  );
}

function profileForModel(model) {
  const meta = engineDefaults[selectedEngine()];
  return meta.modelProfiles.find((profile) => profile.id === model) || null;
}

function populateModelProfiles(meta) {
  const select = $("#model-profile");
  select.replaceChildren();
  meta.modelProfiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    select.append(option);
  });
  const customOption = document.createElement("option");
  customOption.value = CUSTOM_MODEL_PROFILE;
  customOption.textContent = "Custom model ID";
  select.append(customOption);
  select.value = profileForModel(meta.model)?.id || CUSTOM_MODEL_PROFILE;
}

function syncModelProfile() {
  const profile = profileForModel($("#model").value);
  $("#model-profile").value = profile?.id || CUSTOM_MODEL_PROFILE;
  if (profile?.reasoningEffort && selectedEngine() === "codex-cli") {
    $("#reasoning-effort").value = profile.reasoningEffort;
  }
}

function applyModelProfile() {
  const profile = profileForModel($("#model-profile").value);
  if (!profile) return;
  $("#model").value = profile.id;
  if (profile.reasoningEffort && selectedEngine() === "codex-cli") {
    $("#reasoning-effort").value = profile.reasoningEffort;
  }
  refreshCards();
}

function applyEngineDefaults() {
  const meta = engineDefaults[selectedEngine()];
  populateModelProfiles(meta);
  $("#provider").value = meta.provider;
  $("#model").value = meta.model;
  $("#executable").value = meta.executable;
  $("#credential").value = meta.credential;
  const defaultProfile = meta.modelProfiles.find((profile) => profile.id === meta.model);
  $("#reasoning-effort").value = defaultProfile?.reasoningEffort || "medium";
  $("#reasoning-effort").disabled = selectedEngine() !== "codex-cli";
  $("#model-provider").disabled = selectedEngine() !== "pi-cli";
  $("#model-provider").value = meta.modelProvider || "";
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
    else if (element.id === "model-profile") applyModelProfile();
    else if (element.id === "model") {
      syncModelProfile();
      refreshCards();
    }
    else refreshCards();
  });
  element.addEventListener("input", () => {
    if (element.id === "model") syncModelProfile();
    refreshCards();
  });
});

$("#generate-run").addEventListener("click", () => {
  const cases = selectedCases();
  if (!cases.length) {
    showToast("至少选择一个 Case。");
    return;
  }

  const engine = selectedEngine();
  const bundle = buildRunSpecBundle();
  $("#run-spec-preview").value = JSON.stringify(bundle, null, 2);
  $("#run-spec-panel").hidden = false;
  showToast(`RunSpec 已生成：${cases.length} Cases / ${engine}`);
});

$("#download-run-spec").addEventListener("click", () => {
  const blob = new Blob([`${JSON.stringify(buildRunSpecBundle(), null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vis-agent-bench-run-spec-bundle.json";
  link.click();
  URL.revokeObjectURL(url);
  showToast("RunSpec bundle 已下载。");
});

function nullableNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildRunSpec(caseId) {
  const engine = selectedEngine();
  const allowedTools = ["shell", "file_read", "file_write"];
  if ($("#network").checked) allowedTools.push("public_web");
  return {
    schema_version: 2,
    name: `${caseId}-${engine}-${$("#model").value}`,
    case_id: caseId,
    engine: {
      adapter: engine,
      executable: $("#executable").value,
      configured_model: $("#model").value,
      reasoning_effort: engine === "codex-cli" ? $("#reasoning-effort").value : null,
      model_provider: engine === "pi-cli" ? $("#model-provider").value || null : null,
      provider: $("#provider").value,
      credential_ref: $("#credential").value
    },
    isolation: {
      mode: "file-isolated-development",
      leaderboard_eligible: false,
      network: $("#network").checked ? "enabled" : "disabled",
      block_internal_network: false,
      inherited_home_for_auth: true,
      answer_leakage_scan: true,
      workspace_root: ".local/runs"
    },
    permissions: {
      read_internal_source: false,
      read_answer_repository: false,
      hidden_evaluator_visible: false,
      allowed_tools: allowedTools
    },
    budget: {
      wall_time_minutes: Number($("#wall-time").value),
      max_retries: Number($("#retries").value),
      max_tokens: nullableNumber($("#tokens").value),
      max_cost_usd: nullableNumber($("#cost").value)
    },
    scenario: {
      mode: "progressive-disclosure",
      baseline_type: "current-ai-assisted-workflow",
      session_continuity_required: true
    },
    evidence: {
      raw_stdout: $("#evidence-process").checked,
      raw_stderr: $("#evidence-process").checked,
      normalized_events: $("#evidence-process").checked,
      file_snapshots: $("#evidence-workspace").checked,
      git_diff: $("#evidence-workspace").checked,
      screenshots: $("#evidence-browser").checked,
      redact_secrets: true,
      human_review_required: true
    }
  };
}

function buildRunSpecBundle() {
  return {
    schema_version: 1,
    kind: "vis-agent-bench-run-spec-bundle",
    generated_at: new Date().toISOString(),
    runs: selectedCases().map(buildRunSpec)
  };
}

applyEngineDefaults();

globalThis.__VAB_SETUP__ = { buildRunSpec, buildRunSpecBundle };
