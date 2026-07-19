# Evaluator 统一协议

## 1. 设计原则

Evaluator Core 提供可组合的确定性检查生命周期，但不包含任何 Case
业务逻辑。Case Evaluator（VAB-T05 等）只声明 Check 和 Rubric，把执行、
超时、证据落盘、评分和封顶交给 Core。

```text
Case Evaluator (声明 checks + rubric)
        │
        ▼
runEvaluation()  ──►  prepare() → ctx.artifacts
        │
        ├─ runCheck(check, ctx) ──► CheckResult
        │      │
        │      ├─ resolve preconditions (deps, artifacts)
        │      ├─ executeAssertion(command | inline)
        │      ├─ invokeRun(ctx, executor) → outcome
        │      └─ attachExecutorEvidence + failure_source
        │
        ├─ scoreEvaluation(results, rubric) → Scorecard
        │      ├─ category weights & caps
        │      ├─ hard gate / P0 / incomplete caps
        │      └─ accepted / partial / invalid-run
        │
        └─ createEvidenceBundle() → EvidenceBundle (JSON)
```

不引入 Judge 模型；主观审美在 VAB-T06 的人工走查里处理。

## 2. 角色

- **Evaluator Core**（本任务）：Check/Result/Scorecard/Evidence 的数据模型、
  执行生命周期、评分与封顶。位于 `src/evaluators/core/**`。
- **Case Evaluator**（VAB-T05 等）：声明与本 Case 验收契约一一对应的
  确定性 Check；可读取隐藏 fixture，但不得把答案或断言泄漏到 workspace。
- **Human Review**（VAB-T06）：补足无法机器判定的视觉/审美维度，单独
  写入 `human-review.json`，不混入 Scorecard。

## 3. Check 与执行上下文

一个 Check 由 `defineCheck({...})` 声明，必填 `id` 和 `run`：

| 字段 | 说明 |
| --- | --- |
| `id` | kebab/snake-case 唯一 ID，需出现在 rubric 的某个 category 中 |
| `kind` | `machine` 或 `human`；Core 仅执行 `machine`，`human` 占位由 VAB-T06 处理 |
| `level` | `p0` / `p1` / `p2`，参与 P0 cap |
| `category` | 对应 rubric category 名 |
| `weight` | 可选，未指定时由 category 权重平均 |
| `hard_gate` | 命中 `rubric.hard_gates` 即视为 hard gate |
| `timeout_ms` | 单 Check 超时；默认 60 秒 |
| `depends_on` | 依赖的其他 Check ID；未通过则本 Check `skipped` |
| `requires_artifacts` | 缺失则 `skipped`（缺少证据，不算通过） |
| `run(ctx, executor)` | 同步或异步；返回 status 字符串或 `{ status, reason?, evidence?, artifacts? }` |
| `command` | 可选；声明命令式断言（spawn + 捕获 stdout/stderr 路径） |

`createExecutionContext({ runId, caseId, workspace, artifacts, env, abortSignal, logger })`
是 Check.run 收到的 `ctx`。`ctx.getArtifact(id)` / `ctx.hasArtifact(id)`
用于查询 `prepare()` 生成的证据。

## 4. 状态语义

| Status | 含义 | failure_source |
| --- | --- | --- |
| `pass` | 断言通过 | null |
| `fail` | 被测项目违反断言 | `project` |
| `warning` | 断言通过但带 caveat；记一半权重 | null |
| `skipped` | 预条件不满足（依赖、artifact、预算），未执行 | `evaluator` |
| `error` | Evaluator 自身崩溃（抛错、超时、断言非法返回） | `evaluator` |

重要规则：

1. **未执行不算通过**：`skipped`/`error` 计入 `completeness.skipped/harness_errors`，
   会被 `incomplete_cap`（默认 0）封顶。
2. **rubric 覆盖**：Rubric 中声明但 Evaluator 未注册的 Check ID 会被
   `completeness.unrun_rubric_checks` 列出并触发 `incomplete` cap。
3. **重复 ID**：`completeness.duplicate_check_ids` 暴露重复；`runEvaluation`
   在执行前就会抛错，避免相互覆盖。
4. **harness vs project**：`failure_source` 始终区分；Scorecard 的
   `next_actions` 对两类问题给出不同建议。

## 5. 评分与封顶

### 5.1 分类得分

对每个 category：

```text
ran         = pass + fail + warning
denominator = declared_rubric_checks
fraction    = (pass + 0.5 * warning) / denominator
category_score = fraction * category.weight   （仅在完整时计入）
incomplete  = (declared - ran > 0) OR skipped OR error
```

未跑满的 category 得分固定 0，并把整个 Scorecard 标记为 incomplete。

### 5.2 封顶（cap）

封顶按“最严苛者胜”取最低值：

| Cap | 触发 |
| --- | --- |
| `hard_gate` | 任一 hard gate 失败；默认 cap = 0 |
| `p0_failure` | 任一 P0 Check 失败；来自 `caps.p0_failure_max_score` 或 `caps.critical_failure_cap` |
| `incomplete` | 未跑满 / skipped / error / rubric 未覆盖；默认 cap = 0 |
| 命名 cap | `options.capTriggers[<name>]` 为真时，`caps[<name>]` 生效 |

`total = min(raw_total, effective_cap)`。

### 5.3 决策

```text
hard gate fail        → status=error, decision=rejected
harness error         → status=error, decision=invalid-run
rubric check 未执行    → status=error, decision=invalid-run
P0 fail (非 hard gate) → status=warning, decision=partial
否则 total>=p0_min_score → status=success, decision=accepted
否则                     → status=warning, decision=partial
```

### 5.4 Rubric 形态

Core 同时支持 v1 和 legacy 两种形态：

- v1：`{ version:1, total:100, hard_gates:[...], categories:{...}, caps:{...} }`。
- legacy：`{ weights:{...}, gates:{ p0_min_score, critical_failure_cap }, levels:{...} }`；
  Core 会把它折叠为 v1 形态，P0 检测依靠 Check 的 `level` 字段。

## 6. 证据

`createEvidenceBundle({ runId, caseId, results, scorecard, ... })` 生成
单次评估的完整 JSON。规则：

- stdout/stderr 等大体积产物只存路径（`stdout_path`/`stderr_path`）。
- 每个 CheckResult 保留 `command`、`exit_code`、`signal`、`timed_out`、
  `duration_ms`、`failure_source`、`reason`。
- `rubric_fingerprint` 是一个轻量 hash，便于跨 run 检测 rubric 变更。
- `partitionByFailureSource(results)` 把项目失败、Evaluator 崩溃和通过项
  分桶，方便报告分别展示。

### 6.1 Trusted observation attestation

Production Case Evaluator 不接受调用方直接传入的 `observation` 或任意
`observationPath`。控制面必须传入 `runRoot` 与位于该目录内的
`attestationPath`。Attestation schema v1 绑定：

- `run_id`、`case_id` 和非空 `collector.id`；
- observation 文件；
- fixture manifest；
- command evidence 或 workspace/diff evidence（至少一个）；
- browser evidence；
- hidden-control execution evidence。

每个 binding 包含相对 `runRoot` 的路径和文件字节的 lowercase SHA-256。
Evaluator 对 `runRoot`、attestation 和所有 binding 执行 `realpath`，拒绝
绝对/相对路径或 symlink 造成的目录逃逸，并在解析 observation 前重新计算
所有 digest。Attestation 与请求的 run/case 不一致也直接拒绝。

Observation 中每个布尔叶子必须在 `provenance.boolean_facts` 中有来源。
Production 来源只能是 `browser_action`、`browser_state`、`command`、
`workspace_state` 或 `hidden_control`，并提供 source locator、对应 binding
名称及与 attestation 一致的 SHA-256。Locator 必须是指向该 source evidence
中实际存在值的 JSON Pointer。缺 provenance、错误 binding、悬空 locator 或
未绑定 digest 均不得进入评分。

单元测试只有显式传入 `allowTestDouble: true` 才能使用裸 observation 或
`observationPath`。每个布尔值必须标为
`source=test_double, conclusion_eligible=false`；输出 bundle 同时带
`evidence_trust.mode=test-double` 与 `conclusion_eligible=false`，不能作为
真实 benchmark Run 的结论。

该机制提供的是控制面文件完整性、run/case 关联和来源绑定，不是数字签名，
也不是对同一 OS 用户下恶意进程的强隔离。具有同用户文件写权限的进程仍可能
在验证前替换整个证据集合；生产隔离必须由独立用户、容器/沙箱和权限策略补足。

## 7. 错误恢复

`runCheck` 永不抛出。任何异常（断言抛错、超时、spawn 失败、非法返回值）
都会被转化为 `error` 状态并附 `failure_source=evaluator`。后续 Check
仍会尝试执行（除非显式 `depends_on`），让一次 Run 留下完整诊断。

Scorecard 的 `next_actions` 至少包含：

- 每个 hard gate / P0 失败的修复指引；
- 每个未执行 rubric Check 的提醒；
- 每个 harness error 的调查指引；
- 每个重复 Check ID 的去重提醒。

## 8. 当前限制

- Core 不读取 YAML；Case Evaluator 负责把 `rubric.yaml` 解析后传入。
- Core 不接 Judge 模型；主观维度走 VAB-T06。
- 命令式断言目前只覆盖 spawn + 文件捕获；浏览器/DOM 证据由 VAB-T06
  采集后通过 `prepare()` 注入 `ctx.artifacts`。
- 评分以“check 通过比例”为主；更细粒度的部分分（例如布局容差）由
  Case Evaluator 在 Check 内部决定后映射到 `pass/warning/fail`。

## 9. 版本

- `EVALUATOR_CORE_VERSION = 'v1'`
- Status 名、Check 字段、Scorecard 字段均视为冻结契约。扩展字段追加即可；
  改语义或重命名需要新版本号。
