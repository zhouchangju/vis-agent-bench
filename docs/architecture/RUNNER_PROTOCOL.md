# CLI Runner 统一协议

## 原则

Codex、Kimi Code、Claude Code、Pi 都通过命令行非交互模式调用。网页不直接调用进程，而是：

```text
Setup UI → RunSpec → Runner Service → Adapter → CLI Process
                                      ↓
                              Event Normalizer
                                      ↓
                         logs / artifacts / result
```

每个 Adapter 实现同一生命周期：

```text
detect → prepare → preflight → start_session
  → send_stage → stream → checkpoint
  → resume_session → send_stage ... → stop → collect → normalize
```

## RunSpec

RunSpec 至少包含：

- Case ID 和输入版本；
- engine、CLI 版本、provider、模型标识；
- executable 及 Adapter 类型；
- 隔离模式、联网、超时、重试；
- Token/费用/自然时间预算；
- 允许工具和输入附件；
- Secret 引用；
- 输出目录和停止条件。

网页设置页与 YAML 配置是同一对象的两种编辑方式。网页保存 YAML/JSON，CLI 可直接运行该文件。

## 多阶段会话

主 Case 默认不是 one-shot。Runner 读取 `scenario/stages.yaml`，每个阶段：

1. 发送本阶段输入和允许读取的附件；
2. 等待 Agent 产出约定 checkpoint；
3. 运行阶段检查并保存代码、截图和 Requirement Ledger；
4. 记录人工输入和耗时；
5. 在同一会话恢复并发送下一阶段反馈。

若某 CLI 无法可靠恢复会话，Adapter 可用“阶段摘要 + workspace 状态”启动新会话，但必须
记录 `session_continuity=synthetic`，不能与原生连续会话混为一谈。

`requirement-ledger.yaml` 是机器读取的阶段产物：统一要求 Agent 使用 JSON 语法（JSON 是合法 YAML），
并使用 `confirmed`、`decisions`、`assumptions`、`open_questions` 对象数组。这样中文引号、冒号等自然语言
内容不会破坏 YAML 解析；不接受多文档 YAML 或 `- dec:` 等自由格式简写。

Fixture 已有的 `package.json` 中 `build`、`typecheck`、`test` scripts，以及对应
`scripts/build.mjs`、`scripts/typecheck.mjs`、`scripts/test.mjs` 是基线完整性门禁。Agent 可以新增
功能和独立测试，但不得改写这些基线；若某阶段首次 gate 失败，Runner 只允许一次自动重试，并在下一次
Stage Prompt 中注入明确的 gate 失败原因。

标准阶段事件至少包含：

```json
{
  "stage_id": "S2",
  "event_type": "stakeholder_feedback",
  "input_files": ["scenario/packets/S2-poc-feedback.md"],
  "human_minutes": 0,
  "context_bytes": 4821,
  "requirement_ledger_sha256": "...",
  "checkpoint_status": "success"
}
```

## Codex Adapter

本机已探测：

- executable：`codex`
- version：`codex-cli 0.144.6`
- 非交互入口：`codex exec`
- 事件输出：`--json` JSONL
- 最终消息：`--output-last-message`
- 模型：`--model`
- 思考强度：`-c model_reasoning_effort=\"<low|medium|high|xhigh>\"`
- 工作目录：`--cd`
- CLI 内层权限：`--sandbox workspace-write --config 'approval_policy="never"'`
- 联网：RunSpec 启用时传入
  `--config sandbox_workspace_write.network_access=true`；实际可用性仍记录在 Run 证据中。
- 净化：`--ignore-user-config --ignore-rules`。为保持阶段会话连续性，不使用
  `--ephemeral`；该选项不持久化 Session，和后续 `exec resume` 冲突。

概念命令：

```bash
codex exec \
  --cd /workspace \
  -c 'model_reasoning_effort="medium"' \
  --config sandbox_workspace_write.network_access=true \
  --config 'approval_policy="never"' \
  --model "$MODEL_ID" \
  --sandbox workspace-write \
  --ignore-user-config \
  --ignore-rules \
  --json \
  --output-last-message /output/final.md \
  - < /task/prompt.md
```

`codex exec` 本身是非交互入口，不使用交互式 `--ask-for-approval`。多阶段评测必须保留 Session，
因此不能使用 `--ephemeral`；后续阶段使用 `codex exec resume`，并显式传入
`--config 'sandbox_mode="workspace-write"'`。`resume` 子命令不接受 `--sandbox` flag，若不通过
config 重申写权限，恢复阶段可能退回只读。CLI Sandbox 是 Worker 内的第二层限制，不能替代外层容器。

## Claude Code Adapter

本机已探测：

- executable：`claude`
- version：`2.1.177`
- 非交互入口：`claude --print`
- 流式事件：`--output-format stream-json`
- Hook 事件：`--include-hook-events`
- 模型：`--model`
- Effort 级别：`--effort "<low|medium|high>"`（RunSpec `engine.reasoning_effort`；
  仅这三档，xhigh 是 Codex 专属）。不设置时沿用 CLI 自身 settings 的 effortLevel。
- 费用上限：`--max-budget-usd`
- 结构化最终输出：`--json-schema`
- 无人值守权限：`--permission-mode auto`
- 净化：`--safe-mode --strict-mcp-config --no-chrome`。`--safe-mode` 禁用用户与项目
  自定义但保留正常认证；`--bare` 会禁用 OAuth/keychain，因此不用于默认 Adapter。
- 会话：首阶段显式 `--session-id`，后续阶段 `--resume`；不能同时使用
  `--no-session-persistence`，因为官方 CLI 明确说明该选项会使会话不可恢复。

概念命令：

```bash
claude --print \
  --safe-mode \
  --strict-mcp-config \
  --no-chrome \
  --model "$MODEL_ID" \
  --effort "$EFFORT_LEVEL" \
  --permission-mode auto \
  --output-format stream-json \
  --verbose \
  --include-hook-events \
  --max-budget-usd "$MAX_BUDGET_USD" \
  < /task/prompt.md
```

使用 Claude Code 测 GLM、DeepSeek 等第三方模型时，Adapter 还必须记录：

- provider 类型；
- endpoint 的脱敏标识；
- 配置模型名；
- 首个响应中可获得的实际模型名；
- 使用量和费用由谁提供。

只改 `--model` 而没有验证实际 provider，不得把结果归因到目标模型。

`--no-session-persistence` 与多阶段 `--resume` 互斥，禁止同时使用。开发 smoke 已用
`deepseek-v4-flash` 验证 `--print --permission-mode auto` 可以在无人确认下写入受控工作区；
实际运行仍需从 stream-json 的 model usage / provider 事件记录实际模型，不能只相信启动别名。
Claude Code 2.1.177 还要求 `--output-format stream-json` 与 `--verbose` 同时使用，Adapter 必须
保留该参数组合。

## Kimi Code Adapter

当前机器已确认：

- executable：`/Users/leozhou/.kimi-code/bin/kimi`
- version：`0.27.0`
- 非交互入口：`--prompt`
- 流式事件：`--output-format stream-json`
- 模型：`--model`
- 非交互 `--prompt` 模式：按 Kimi Code 0.27.0 的命令协议使用 auto 权限；
- 交互模式另有 `--yolo`，它会自动批准普通工具调用，但仍可能向用户提问；
- Skills 隔离：`--skills-dir`

概念命令：

```bash
/Users/leozhou/.kimi-code/bin/kimi \
  --model "$MODEL_ID" \
  --prompt "$PROMPT" \
  --output-format stream-json \
  --skills-dir /run/empty-skills
```

Kimi 使用工作目录作为主 workspace。Token/费用只在 stream-json 实际提供时记录，否则标记
`unavailable`。

### Kimi YOLO、Auto 与无人值守

本机 0.27.0 的 `kimi --help` 已确认支持 `--yolo` 和 `--auto`。官方命令文档进一步区分：

- `--yolo`：跳过工具审批，但用户仍被视为在线，Agent 仍可能调用 `AskUserQuestion`；
- `--auto` / 非交互 `--prompt`：用于无人值守，自动处理审批并避免等待用户问题；
- 新版文档中 `--prompt` 与显式 `--yolo`、`--auto` 互斥，非交互模式自行启用 auto 语义。

因此 Adapter 不把 YOLO 当成无人值守开关，也不能将 `--yolo` 与 `--prompt` 组合。每次 Run
必须记录 `permission_mode=noninteractive-auto` 及 CLI 版本；若未来 CLI 参数语义变化，按版本
能力探测构造命令，而不是静态假设。

## Pi Adapter

Pi 作为独立 CLI Provider Adapter 接入，首个已支持的实际 Provider 是 DeepSeek：

- executable：`pi`；
- 非交互输出：`--mode print`。Pi 的 JSON event mode 会在长工具调用中重复完整消息，可能形成
  超大日志；阶段日志、workspace 产物和 checkpoint 已提供可回溯证据；
- 模型与实际 Provider：`--model "$MODEL_ID" --provider "$MODEL_PROVIDER"`；
- 凭据：通过子进程白名单传入 `DEEPSEEK_API_KEY`，不写入命令或日志；
- 无人值守：`--approve`；
- 上下文净化：`--no-context-files --no-extensions --no-skills --no-prompt-templates`；
- 工具：显式限制为 `read,bash,edit,write,grep,find,ls`；
- 会话：每个 Run 使用 `<runDir>/.pi-sessions`，后续 Stage 使用 `--continue` 恢复该隔离目录中的
  最近会话；
- 费用：没有可由 Harness 验证的原生单阶段费用上限，真实运行必须确认
  `--acknowledge-no-cost-cap`。

概念命令：

```bash
pi --mode print --approve \
  --no-context-files --no-extensions --no-skills --no-prompt-templates \
  --session-dir /run/.pi-sessions \
  --tools read,bash,edit,write,grep,find,ls \
  --provider deepseek --model deepseek-chat \
  "$STAGE_PROMPT"
```

### 无人值守确认协议

需要区分两种确认：

1. **业务澄清**：Agent 将问题写入 Requirement Ledger，并以
   `needs_clarification` 结束本阶段；标准回归由 Runner 从固定答复包恢复会话；
2. **工具权限**：运行前由 RunSpec 决定。白名单内自动执行，白名单外直接拒绝并记录事件，
   不进入交互等待。

阶段 Prompt 必须说明：

- 不等待实时人工确认；
- 可逆、低风险事项采用显式假设继续，并记录假设；
- 只有缺少关键业务决策且无法安全继续时才返回 `needs_clarification`；
- 无法恢复的权限或环境问题返回 `blocked`，不得伪报成功。

Runner 对 `needs_clarification` 最多自动答复固定次数；对 `blocked` 最多按安全策略重试一次。
达到停止条件后保存已有证据并结束，不允许无限循环。

## 首期文件级软隔离

为了先跑通流程，MVP 允许：

- 每个 Run 使用全新目录和新 Git 仓库；
- 只复制模型可见输入和清洗后的起始工程；
- 删除 `.git`、构建产物、缓存和已知答案；
- 启动前执行答案泄漏扫描；
- 通过 CLI 参数禁用规则、Skills、浏览器和历史 Session；
- 使用当前用户认证配置启动 CLI。

该模式不能从操作系统层面阻止进程读取主机其他目录，必须标记：

`file-isolated-development / leaderboard_eligible=false`

它适合首期验证 Runner、Case 和报告流程，不适合作为最终可信排行榜依据。

## 日志与输出

Adapter 不能只保存最终回答。每次 Run 至少产生：

```text
logs/
├── command.json
├── environment.json
├── stdout.raw
├── stderr.raw
├── events.jsonl
├── normalized-events.jsonl
├── files-before.json
├── files-after.json
└── git.diff
artifacts/
├── final-message.md
├── screenshots/
├── test-results/
└── agent-summary.json
result.json
```

`command.json` 和 `environment.json` 必须脱敏，永远不记录 Secret 值。

日志采用两层证据：

1. **Runner 外部观测**：命令、stdout/stderr、原始与归一化事件、阶段前后文件树、Git diff、
   权限拒绝、超时和退出状态。这是不可由 Agent 自述替代的客观证据；
2. **Agent 工作区记录**：`requirement-ledger.yaml`、POC 计划、限制说明和阶段测试结果。
   这些用于理解 Agent 的判断，但必须与外部观测和 Evaluator 交叉验证。

每个阶段进入下一阶段前至少检查：进程已退出、约定 checkpoint 存在、Ledger 可解析、构建/
测试门禁满足、没有未处理的权限等待。未通过时不得继续发送与实际产物不一致的“评审反馈”。

## 遥测与归一化契约（VAB-T01）

三种 Adapter 的命令构建、版本探测、Session 连续性和输出解析统一在
`src/runners/adapters.mjs` 与 `src/telemetry/*` 中实现。协议约束：

### Adapter 统一接口

每个 Adapter 必须暴露同一组纯函数字段：

| 字段 | 用途 |
|---|---|
| `id` | 与 `RunSpec.engine.adapter` 对齐的稳定标识（`codex` / `kimi` / `claude` / `pi`）。 |
| `executable` | 默认可执行路径，可被 `RunSpec.engine.executable` 覆盖。 |
| `versionArgs` | 探测版本所用的参数，默认 `['--version']`。 |
| `parseVersion(stdout\|stderr)` | 从版本输出中解析 semver 字符串，找不到时返回 `null`。 |
| `session_continuity` | `native` / `native-working-directory` / `synthetic`。 |
| `build(spec, runDir, stageId, session)` | 兼容 `scripts/bench.mjs` 的入口；返回 `{ executable, args, stdin, format }`。 |
| `buildCommand(ctx)` | 纯函数命令构建；输入仅依赖 `ctx` 字段，便于快照测试。 |

命令构造不能凭空假设 RunSpec 字段；所有可变参数（model、cost 上限、空 Skill 目录）通过
`ctx` 显式传入。`build` 仍然读 `input/stage-<id>.md` 文件，是为了与 `bench.mjs` 的现有
工作目录布局兼容；越界修改 `bench.mjs` 的工作由 VAB-T08 负责。

### 命令脱敏

写入 `command.json` / `environment.json` 前必须调用 `redactCommand(command, ctx)`，
把 prompt 替换为 `<PROMPT>`、stdin 替换为 `<STDIN>` 或 `<PROMPT>`。
Adapter 命令本身不携带凭据值——凭据通过 Secret 引用注入环境变量，并由 Worker 控制。

### 归一化事件

`src/telemetry/events.mjs` 的 `normalizeStdout(text, options)` 把任意 stdout（jsonl 或 plain
text）转为 `RUN_LOG_SPEC` 定义的事件流。必须容忍以下故障模式，且不抛异常：

- 截断的 JSONL 行（最后一行不完整）→ `status='recovered'`，原始文本保留在 `data.text` 与
  `stats.truncated_lines`；
- 未知事件类型 → 原样保留 `type`，并加入 `stats.unknown_types`；
- 混合输出（JSONL 与非 JSON 文本交错）→ 非 JSON 行记为 `process.output`；
- 完全空输出 → `empty=true`，事件数组为空；
- 非零退出但仍有部分输出 → 仍然归一化已收集的事件，恢复判定交给 `recovery.mjs`。

每个事件至少包含：`ts / run_id / stage_id / seq / source / type / status / summary / data / raw_ref`。

CLI 私有事件名通过别名表映射回标准字典，例如 Claude 的 `assistant → assistant.message`、
`tool_use → tool.started`、`tool_result → tool.ended`、`result → usage.report`。

### Token 与费用 provenance

`src/telemetry/usage.mjs` 的 `aggregateUsage(events, options)` 按以下规则归并：

| provenance | 触发条件 |
|---|---|
| `native_cli` | CLI 输出了 token，但没有显式 cost 字段。 |
| `provider_api` | 事件中显式出现 `cost_usd` / `costUsd` / `total_cost_usd`。 |
| `estimated` | 调用方显式 `allowEstimate=true` 且提供估算 token。**默认禁用**。 |
| `unavailable` | 没有任何 usage 事件，且未开启估算。 |

禁止根据输出文本长度伪造 token；拿不到时必须记录 `unavailable` + `reason`。
已知 token、未知单价时记录 token 并把 cost 标为 `unavailable`。

### 时间口径

`src/telemetry/timings.mjs` 区分：

- `wall_ms`：CLI 进程自然时间（start → close/kill）；
- `first_byte_ms` / `last_byte_ms` / `stream_ms`：基于观察到的首/末事件时间；
- `cpu_ms`：可观察到 CPU 时间，否则 `null`；
- `exit_code` / `signal` / `timed_out`：进程结束事实；
- `status`：`success` / `error` / `timeout` / `recovered`。

`aggregateRunTiming` 汇总 Run 级 wall time、阶段成功数、失败数（含超时）和空输出标记。
所有时间为整数毫秒，时间源记为 `time_source`（当前实现：`harness_clock`）。

### 恢复行为

`src/telemetry/recovery.mjs` 综合归一化 stats、timing 和 exit code，输出：

```text
status: ok | recovered | unrecovered
codes: [timeout, killed, non_zero_exit, truncated_output, unknown_events, empty_output]
root_cause_hint / safe_retry / stop_condition
evidence_preserved: true
```

恢复判定：

- 截断 / 未知事件但 `exit 0` 且未超时 → `recovered`，原始证据保留；
- 非零 exit / 超时 / 空输出 → `uncovered`，禁止删除已收集的 stdout/stderr。

`toRecoveryEnvelope(input)` 输出可直接嵌入 `result.error` 块的
`root_cause_hint / safe_retry / stop_condition` 字段（与 `CONTROL_PROTOCOL` 第 5 节一致）。

## 停止条件

- CLI 正常退出；
- 超过自然时间、Token 或费用预算；
- 连续无输出且无文件变化；
- workspace 超过空间上限；
- 隔离违规；
- 进程生成失控子进程；
- 人工终止。

终止后仍需 collect，保留失败证据。
