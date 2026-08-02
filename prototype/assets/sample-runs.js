// Shared sample data for prototype pages: runs, evidence, compare.
// All data is fabricated for UI prototyping; no real benchmark results.

const SAMPLE_RUNS = [
  {
    run_id: "run-20260720-001",
    case_id: "macro-map-3d-greenfield",
    case_name: "Macro Map 3D",
    engine: "codex",
    model: "gpt-5.6",
    provider: "openai",
    status: "completed",
    started_at: "2026-07-20T09:30:00.000Z",
    completed_at: "2026-07-20T11:42:00.000Z",
    duration_ms: 7920000,
    wall_time_minutes: 132,
    scenario: {
      mode: "progressive-disclosure",
      stage_ids: ["S0","S1","S2","S3","S4","S5","S6","S7"],
      current_stage: null,
      completed_stages: ["S0","S1","S2","S3","S4","S5","S6","S7"]
    },
    stages: [
      { stage_id: "S0", status: "success", exit_code: 0, duration_ms: 1200000, attempts: 1, label: "需求对齐" },
      { stage_id: "S1", status: "success", exit_code: 0, duration_ms: 1800000, attempts: 1, label: "技术方案" },
      { stage_id: "S2", status: "success", exit_code: 0, duration_ms: 900000, attempts: 1, label: "基础搭建" },
      { stage_id: "S3", status: "success", exit_code: 0, duration_ms: 1500000, attempts: 1, label: "核心开发" },
      { stage_id: "S4", status: "success", exit_code: 1, duration_ms: 960000, attempts: 2, label: "视觉优化" },
      { stage_id: "S5", status: "success", exit_code: 0, duration_ms: 600000, attempts: 1, label: "性能优化" },
      { stage_id: "S6", status: "success", exit_code: 0, duration_ms: 480000, attempts: 1, label: "测试构建" },
      { stage_id: "S7", status: "success", exit_code: 0, duration_ms: 480000, attempts: 1, label: "产出验收" }
    ],
    usage: {
      input_tokens: 185000,
      output_tokens: 92000,
      cached_tokens: 34000,
      cost_usd: 4.82,
      availability: "reported"
    },
    scorecard: {
      total_score: 82,
      p0_passed: 3,
      p0_total: 3,
      p1_passed: 5,
      p1_total: 6,
      p2_passed: 4,
      p2_total: 5
    },
    human_review_status: "pending",
    isolation: { mode: "file-isolated-development", leaderboard_eligible: false }
  },
  {
    run_id: "run-20260720-002",
    case_id: "macro-map-3d-greenfield",
    case_name: "Macro Map 3D",
    engine: "kimi",
    model: "kimi-k3",
    provider: "moonshot",
    status: "completed",
    started_at: "2026-07-20T10:00:00.000Z",
    completed_at: "2026-07-20T12:12:00.000Z",
    duration_ms: 7920000,
    wall_time_minutes: 132,
    scenario: {
      mode: "progressive-disclosure",
      stage_ids: ["S0","S1","S2","S3","S4","S5","S6","S7"],
      current_stage: null,
      completed_stages: ["S0","S1","S2","S3","S4","S5","S6","S7"]
    },
    stages: [
      { stage_id: "S0", status: "success", exit_code: 0, duration_ms: 1080000, attempts: 1, label: "需求对齐" },
      { stage_id: "S1", status: "success", exit_code: 0, duration_ms: 1620000, attempts: 1, label: "技术方案" },
      { stage_id: "S2", status: "success", exit_code: 0, duration_ms: 720000, attempts: 1, label: "基础搭建" },
      { stage_id: "S3", status: "success", exit_code: 0, duration_ms: 1320000, attempts: 1, label: "核心开发" },
      { stage_id: "S4", status: "success", exit_code: 0, duration_ms: 720000, attempts: 1, label: "视觉优化" },
      { stage_id: "S5", status: "success", exit_code: 0, duration_ms: 600000, attempts: 1, label: "性能优化" },
      { stage_id: "S6", status: "failed", exit_code: 1, duration_ms: 720000, attempts: 2, label: "测试构建" },
      { stage_id: "S7", status: "success", exit_code: 0, duration_ms: 540000, attempts: 1, label: "产出验收" }
    ],
    usage: {
      input_tokens: null,
      output_tokens: null,
      cached_tokens: null,
      cost_usd: null,
      availability: "unavailable"
    },
    scorecard: {
      total_score: 78,
      p0_passed: 2,
      p0_total: 3,
      p1_passed: 5,
      p1_total: 6,
      p2_passed: 4,
      p2_total: 5
    },
    human_review_status: "pending",
    isolation: { mode: "file-isolated-development", leaderboard_eligible: false }
  },
  {
    run_id: "run-20260720-003",
    case_id: "narrative-equity-relationship",
    case_name: "股权关系叙事可视化",
    engine: "kimi",
    model: "kimi-k3",
    provider: "moonshot",
    status: "running",
    started_at: "2026-07-20T11:30:00.000Z",
    completed_at: null,
    duration_ms: null,
    wall_time_minutes: 48,
    scenario: {
      mode: "progressive-disclosure",
      stage_ids: ["S0","S1","S2","S3","S4","S5"],
      current_stage: "S3",
      completed_stages: ["S0","S1","S2"]
    },
    stages: [
      { stage_id: "S0", status: "success", exit_code: 0, duration_ms: 960000, attempts: 1, label: "需求对齐" },
      { stage_id: "S1", status: "success", exit_code: 0, duration_ms: 1200000, attempts: 1, label: "关系数据建模" },
      { stage_id: "S2", status: "success", exit_code: 0, duration_ms: 720000, attempts: 1, label: "布局与渲染" },
      { stage_id: "S3", status: "running", exit_code: null, duration_ms: null, attempts: 1, label: "动画与叙事" },
      { stage_id: "S4", status: "pending", exit_code: null, duration_ms: null, attempts: 0, label: "媒体联动" },
      { stage_id: "S5", status: "pending", exit_code: null, duration_ms: null, attempts: 0, label: "产出验收" }
    ],
    usage: {
      input_tokens: null,
      output_tokens: null,
      cached_tokens: null,
      cost_usd: null,
      availability: "unavailable"
    },
    scorecard: null,
    human_review_status: "pending",
    isolation: { mode: "file-isolated-development", leaderboard_eligible: false }
  }
];

// Evidence data keyed by run_id
const SAMPLE_EVIDENCE = {
  "run-20260720-001": {
    commands: [
      { stage_id: "S0", executable: "codex", exit_code: 0, duration_ms: 1180000, args: "--model gpt-5.6 --prompt <alignment>" },
      { stage_id: "S1", executable: "codex", exit_code: 0, duration_ms: 1790000, args: "--continue --prompt <tech-plan>" },
      { stage_id: "S2", executable: "codex", exit_code: 0, duration_ms: 880000, args: "--continue --prompt <scaffold>" },
      { stage_id: "S3", executable: "codex", exit_code: 0, duration_ms: 1490000, args: "--continue --prompt <core-dev>" },
      { stage_id: "S4", executable: "codex", exit_code: 1, duration_ms: 450000, args: "--continue --prompt <visual> (attempt 1 failed)" },
      { stage_id: "S4", executable: "codex", exit_code: 0, duration_ms: 500000, args: "--continue --prompt <visual> (attempt 2 OK)" },
      { stage_id: "S5", executable: "codex", exit_code: 0, duration_ms: 590000, args: "--continue --prompt <perf>" },
      { stage_id: "S6", executable: "npm", exit_code: 0, duration_ms: 46000, args: "run build" },
      { stage_id: "S6", executable: "npm", exit_code: 0, duration_ms: 52000, args: "run test" },
      { stage_id: "S7", executable: "codex", exit_code: 0, duration_ms: 470000, args: "--continue --prompt <acceptance>" }
    ],
    browser: {
      screenshots: [
        { label: "首页全景", filename: "screenshot-fullpage.png", size_bytes: 482000 },
        { label: "节点交互", filename: "screenshot-node-click.png", size_bytes: 391000 },
        { label: "WebGL 性能", filename: "screenshot-webgl-stats.png", size_bytes: 274000 }
      ],
      dom_snapshots: [
        { label: "静态 DOM 树", filename: "dom-snapshot.html", size_bytes: 184000, node_count: 2147 },
        { label: "交互后 DOM", filename: "dom-after-interaction.html", size_bytes: 197000, node_count: 2293 }
      ],
      console_errors: 0,
      console_warnings: 3
    },
    workspace_diff: {
      files_changed: 12,
      files_added: 8,
      files_deleted: 1,
      lines_added: 1847,
      lines_deleted: 112,
      summary: "diff --git a/src/index.html b/src/index.html\n--- /dev/null\n+++ b/src/index.html\n@@ -0,0 +1,320 @@\n+<!doctype html>\n+<html lang=\"zh-CN\">\n+<head>\n+  <meta charset=\"utf-8\">\n+  <title>Macro Map 3D</title>\n+  <style>\n+    body { margin: 0; background: #0a0f14; font-family: sans-serif; }\n+    canvas { display: block; }\n+  </style>\n+</head>\n+<body>\n+  <canvas id=\"map\"></canvas>\n+  <script type=\"module\">\n+    import { Map3D } from './map-core.js';\n+    new Map3D(document.getElementById('map')).render();\n+  </script>\n+</body>\n+</html>"
    },
    attestation: {
      bindings: [
        { stage_id: "S0", sha256: "a3f8b2c1...e4d5", algorithm: "SHA-256", file: "run/input/stage-S0.md" },
        { stage_id: "S1", sha256: "b7c4d9e2...f1a6", algorithm: "SHA-256", file: "run/input/stage-S1.md" },
        { stage_id: "S2", sha256: "c2e8f3d1...b9a7", algorithm: "SHA-256", file: "run/workspace/package.json" },
        { stage_id: "S7", sha256: "d5a1e4c7...3f8b", algorithm: "SHA-256", file: "run/workspace/dist/bundle.js" }
      ],
      verified: true,
      verified_at: "2026-07-20T11:45:00.000Z"
    }
  },
  "run-20260720-002": {
    commands: [
      { stage_id: "S0", executable: "kimi", exit_code: 0, duration_ms: 1070000, args: "--model kimi-k3 --prompt <alignment>" },
      { stage_id: "S1", executable: "kimi", exit_code: 0, duration_ms: 1610000, args: "--continue --prompt <tech-plan>" },
      { stage_id: "S2", executable: "kimi", exit_code: 0, duration_ms: 710000, args: "--continue --prompt <scaffold>" },
      { stage_id: "S3", executable: "kimi", exit_code: 0, duration_ms: 1310000, args: "--continue --prompt <core-dev>" },
      { stage_id: "S4", executable: "kimi", exit_code: 0, duration_ms: 710000, args: "--continue --prompt <visual>" },
      { stage_id: "S5", executable: "kimi", exit_code: 0, duration_ms: 590000, args: "--continue --prompt <perf>" },
      { stage_id: "S6", executable: "npm", exit_code: 0, duration_ms: 48000, args: "run build" },
      { stage_id: "S6", executable: "npm", exit_code: 1, duration_ms: 63000, args: "run test (FAILED - 2/14 tests)" },
      { stage_id: "S7", executable: "kimi", exit_code: 0, duration_ms: 530000, args: "--continue --prompt <acceptance>" }
    ],
    browser: {
      screenshots: [
        { label: "首页全景", filename: "screenshot-fullpage.png", size_bytes: 511000 },
        { label: "节点交互（有缺陷）", filename: "screenshot-node-click.png", size_bytes: 402000 }
      ],
      dom_snapshots: [
        { label: "静态 DOM 树", filename: "dom-snapshot.html", size_bytes: 196000, node_count: 2280 }
      ],
      console_errors: 2,
      console_warnings: 5
    },
    workspace_diff: {
      files_changed: 14,
      files_added: 9,
      files_deleted: 0,
      lines_added: 2103,
      lines_deleted: 87,
      summary: "diff --git a/src/index.html b/src/index.html\n--- /dev/null\n+++ b/src/index.html\n@@ -0,0 +1,348 @@\n+<!doctype html>\n+<html lang=\"zh-CN\">\n+<head>\n+  <meta charset=\"utf-8\">\n+  <title>Macro Map 3D (Kimi)</title>\n+  <style>\n+    body { margin: 0; background: #0a0f14; font-family: sans-serif; }\n+    canvas { display: block; }\n+  </style>\n+</head>\n+<body>\n+  <canvas id=\"map\"></canvas>\n+  <script type=\"module\">\n+    import { Map3D } from './map-core.js';\n+    new Map3D(document.getElementById('map')).render();\n+  </script>\n+</body>\n+</html>"
    },
    attestation: {
      bindings: [
        { stage_id: "S0", sha256: "e1f2a3b4...c5d6", algorithm: "SHA-256", file: "run/input/stage-S0.md" },
        { stage_id: "S1", sha256: "f3a4b5c6...d7e8", algorithm: "SHA-256", file: "run/input/stage-S1.md" },
        { stage_id: "S7", sha256: "a9b8c7d6...e5f4", algorithm: "SHA-256", file: "run/workspace/dist/bundle.js" }
      ],
      verified: true,
      verified_at: "2026-07-20T12:15:00.000Z"
    }
  },
  "run-20260720-003": {
    commands: [
      { stage_id: "S0", executable: "kimi", exit_code: 0, duration_ms: 950000, args: "--model kimi-k3 --prompt <alignment>" },
      { stage_id: "S1", executable: "kimi", exit_code: 0, duration_ms: 1190000, args: "--continue --prompt <data-modeling>" },
      { stage_id: "S2", executable: "kimi", exit_code: 0, duration_ms: 710000, args: "--continue --prompt <layout-render>" },
      { stage_id: "S3", executable: "kimi", exit_code: null, duration_ms: null, args: "--continue --prompt <animation> [RUNNING]" }
    ],
    browser: {
      screenshots: [],
      dom_snapshots: [],
      console_errors: null,
      console_warnings: null
    },
    workspace_diff: null,
    attestation: {
      bindings: [
        { stage_id: "S0", sha256: "b1c2d3e4...f5a6", algorithm: "SHA-256", file: "run/input/stage-S0.md" },
        { stage_id: "S1", sha256: "c3d4e5f6...a7b8", algorithm: "SHA-256", file: "run/input/stage-S1.md" }
      ],
      verified: true,
      verified_at: "2026-07-20T12:05:00.000Z"
    }
  }
};

// Helper to get a run by id (from sample data or localStorage)
function getRunById(runId) {
  const sample = SAMPLE_RUNS.find(function(r) { return r.run_id === runId; });
  if (sample) return sample;

  var stored = localStorage.getItem("vab-runs");
  if (stored) {
    try {
      var runs = JSON.parse(stored);
      return runs.find(function(r) { return r.run_id === runId; }) || null;
    } catch (e) { /* ignore */ }
  }
  return null;
}

// Helper to get evidence for a run
function getEvidence(runId) {
  return SAMPLE_EVIDENCE[runId] || null;
}

// Helper to get all runs (sample data merged with localStorage)
function getAllRuns() {
  var stored = localStorage.getItem("vab-runs");
  var extra = [];
  if (stored) {
    try { extra = JSON.parse(stored); } catch (e) { /* ignore */ }
  }
  return SAMPLE_RUNS.concat(extra);
}
