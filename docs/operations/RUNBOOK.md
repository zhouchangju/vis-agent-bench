# 评测运行手册

本文档统一说明 vis-agent-bench 的测试、真实模型调用、指定 Case、证据采集和报告生成方式。

## 入口分层

| 目的 | 命令 | 调用真实模型 | 可形成业务结论 |
| --- | --- | --- | --- |
| 平台单元与契约测试 | `npm test` | 否 | 否 |
| L0 确定性开发 Smoke | `npm run smoke:flow` | 否 | 否 |
| L1 真实模型开发 Smoke | `npm run smoke:flow:real` | 是 | 否 |
| L2 指定正式 Case | `npm run bench:case -- --case <case-id> ...` | 是 | 完成人工评审后可以 |

L0、L1 报告带“演示数据”标识。尚未完成人工评审的 L2 是真实运行证据，但仍不得用于模型
排行榜或领导结论。

## 运行前检查

```bash
npm run bench:doctor
```

该命令检查 Codex、Kimi Code、Claude Code 等 CLI 是否可用。当前一键真实模型入口已验证的
组合是 Claude Code 调用 DeepSeek：

```bash
claude --model deepseek-v4-flash
```

统一入口会通过非交互参数运行 Claude，保存流式事件、阶段 stdout/stderr、checkpoint、Token
和 CLI 上报费用。模型没有上报的数据保持“暂无”，不按文本长度估算。

## L0：零费用验证平台流程

```bash
npm run smoke:flow
```

适合日常开发和 CI。它使用固定 Mock Agent，通常数秒结束，验证：

> 多阶段输入 → 产物 → checkpoint → 日志 → 自动评估 → 中文 HTML 报告

## L1：用真实 DeepSeek 验证平台流程

```bash
npm run smoke:flow:real
```

默认等价于：

```bash
npm run bench:case -- \
  --case dev-workflow-smoke \
  --engine claude \
  --model deepseek-v4-flash \
  --provider claude-code-configured-provider \
  --wall-time-minutes 10 \
  --max-stage-cost-usd 0.50
```

这是一个三阶段极简 Case。`--max-stage-cost-usd` 是单阶段预算，理论 Run 上限是单阶段预算乘以
阶段数。实际费用以 Claude CLI 事件为准。

## L2：指定某个正式 Case

先零费用检查 Case、Fixture、阶段数和预算解析：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine claude \
  --model deepseek-v4-flash \
  --max-stage-cost-usd 2 \
  --wall-time-minutes 180 \
  --dry-run
```

确认后移除 `--dry-run`，即可真实运行：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine claude \
  --model deepseek-v4-flash \
  --max-stage-cost-usd 2 \
  --wall-time-minutes 180
```

### 参数说明

| 参数 | 必填情况 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--case <id>` | 建议显式传入 | `dev-workflow-smoke` | Case 目录名，例如 `narrative-equity-relationship`。 |
| `--engine <codex\|claude\|kimi\|pi>` | 否 | `claude` | 选择实际 CLI Adapter。当前一键入口支持 Codex、Claude Code、Kimi Code 和 Pi。 |
| `--model <id>` | 否 | 按引擎推导 | 传给对应 CLI 的模型标识。Codex 默认 `gpt-5.6-sol`；Claude 默认 `deepseek-v4-flash`；Kimi 默认 `kimi-code/k3`；Pi 默认 `deepseek-chat`。 |
| `--model-provider <id>` | Pi 可选 | `deepseek` | Pi 实际调用的 Provider，映射为 Pi 的 `--provider`，例如 `deepseek`。不要与仅用于报告标记的 `--provider` 混淆。 |
| `--reasoning-effort <low\|medium\|high\|xhigh>` | Codex 可选 | `medium` | 仅用于 Codex；映射为 `-c model_reasoning_effort=\"…\"`，会写入 RunSpec 和命令日志。 |
| `--provider <label>` | 否 | 按引擎推导 | 记录用的脱敏 Provider 标签，不是 API endpoint；Codex 默认为 `openai-codex-configured-provider`。 |
| `--wall-time-minutes <n>` | 否 | Smoke 为 10，正式 Case 为 180 | 整个 Run 的墙钟时间硬上限，不是每阶段上限。超时后终止当前进程并保留证据。 |
| `--max-stage-cost-usd <n>` | Claude 正式 Case 必填 | Smoke 为 0.50 | Claude CLI 的单阶段原生费用上限；理论 Run 上限为该值乘以阶段数。Codex、Kimi、Pi 不支持该参数。 |
| `--acknowledge-no-cost-cap` | Codex/Kimi/Pi 真实运行必填 | 无 | 明确确认 CLI 没有可由 Harness 强制执行的费用上限；仅用于防误操作，不代表费用为零。 |
| `--workspace-source <path>` | 否 | 自动选择 Case Fixture | 覆盖输入工作区。必须是脱敏且不含答案实现的绝对路径。 |
| `--dry-run` | 否 | 关闭 | 只解析并展示配置，不准备 Run、不调用模型、不产生费用。 |

兼容参数 `--max-cost-usd` 等价于 `--max-stage-cost-usd`，只建议旧脚本继续使用。

## 使用 Codex（GPT-5.6 Sol + 思考强度）

先零费用检查命令和配置：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine codex \
  --model gpt-5.6-sol \
  --reasoning-effort medium \
  --wall-time-minutes 180 \
  --dry-run
```

确认后执行真实运行：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine codex \
  --model gpt-5.6-sol \
  --reasoning-effort medium \
  --wall-time-minutes 180 \
  --acknowledge-no-cost-cap
```

`--reasoning-effort` 可用值为 `low`、`medium`、`high`、`xhigh`。它不是 Prompt 文本，而是 Codex
运行配置：Harness 传递 `-c model_reasoning_effort=\"medium\"`，并在 `run-spec.json` 和
`logs/commands.json` 留存。Codex 的 `exec` 是非交互入口；它使用 `workspace-write` Sandbox，阶段间
保留 Session，以便后续 `resume` 延续需求澄清上下文。

Codex CLI 当前同样没有原生费用硬上限，因此真实运行也必须加入
`--acknowledge-no-cost-cap`；Harness 会强制墙钟时间，Token/费用仅在 JSONL 事件明确上报时记录。

## 使用 Kimi K3

本机已确认：

- Kimi Code：`/Users/leozhou/.kimi-code/bin/kimi`
- 版本：`0.27.0`
- K3 模型别名：`kimi-code/k3`
- 配置检查：`kimi doctor` 通过

先检查配置，不调用模型：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine kimi \
  --model kimi-code/k3 \
  --wall-time-minutes 180 \
  --dry-run
```

真实运行：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine kimi \
  --model kimi-code/k3 \
  --wall-time-minutes 180 \
  --acknowledge-no-cost-cap
```

底层等价于由 Runner 分阶段调用：

```bash
/Users/leozhou/.kimi-code/bin/kimi \
  --model kimi-code/k3 \
  --prompt "<当前阶段 Prompt>" \
  --output-format stream-json \
  --skills-dir "<Run 目录>/.empty-skills"
```

后续阶段在同一隔离工作目录增加 `--continue`，延续前一阶段 Session。`--prompt` 本身使用
非交互 auto 权限语义，因此不与 `--yolo` 或 `--auto` 组合，避免 CLI 参数冲突和等待人工确认。

Kimi CLI 当前没有类似 Claude `--max-budget-usd` 的原生费用上限。Harness 只能强制墙钟超时；
Token 和费用仅在 stream-json 明确上报时记录，否则报告显示“暂无”，不会自行估算。

## 使用 Pi 直连 DeepSeek

Pi 使用 `--mode print`，避免 JSON event mode 在长工具调用中重复完整消息而生成超大日志；需要先在当前
shell 中配置 DeepSeek 凭据：

```bash
export DEEPSEEK_API_KEY='…'

npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine pi \
  --model deepseek-chat \
  --model-provider deepseek \
  --wall-time-minutes 180 \
  --dry-run
```

确认配置后移除 `--dry-run`，并加入费用确认：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine pi \
  --model deepseek-chat \
  --model-provider deepseek \
  --wall-time-minutes 180 \
  --acknowledge-no-cost-cap
```

Adapter 固定传入 `--approve`、`--no-context-files`、`--no-extensions`、`--no-skills` 和
`--no-prompt-templates`，并只开放 `read,bash,edit,write,grep,find,ls` 这些 Pi 内置工具。每个 Run
使用自己的 `.pi-sessions/`，后续阶段以 `--continue` 续跑。Pi 没有 Harness 可验证的原生费用上限，
因此只能由墙钟超时、日志和事后 usage 记录控制。

可指定的现有 Case：

- `narrative-equity-relationship`：股权关系叙事可视化，主 Case；
- `macro-map-3d-greenfield`：从零 3D 场景，主 Case；
- `ainvest-market-heatmap-rebuild`：AInvest 热力地图复刻，主 Case；
- `standard-chart-two-way-tree`：产业链双向树，备选；已具备合成 Starter Fixture 与确定性 evaluator（backup case，未加入 PRIMARY_CASES，需显式指定 case id 才会运行）；
- `dev-workflow-smoke`：平台开发专用，不评估复杂可视化能力。

默认优先使用 `cases/<case-id>/fixture/starter`；不存在时使用 `fixture`。也可显式覆盖：

```bash
--workspace-source /absolute/path/to/sanitized-fixture
```

Claude 正式 Case 必须显式提供 `--max-stage-cost-usd`。Codex、Kimi、Pi 真实运行必须显式提供
`--acknowledge-no-cost-cap`。默认总墙钟上限为 180 分钟；开发 Smoke 默认 10 分钟。

## 流程通过不等于业务验收

正式 Case 自动运行结束后分为两层结论：

1. 流程门禁：CLI 是否完成、阶段 checkpoint 是否存在、日志和产物是否完整；
2. 业务验收：布局、视觉、动画、交互、业务含义和可用性是否达到要求。

机器只能直接判断第一层。第二层必须运行浏览器评审并补录人工评分、问题、修改时间和最终
验收结论。因此正式 Case 的自动报告会显示 `P0 待评审`，不会把“文件齐全”误写成“业务通过”。

## 权限与无人值守

- Claude Code 使用非交互模式和 `--permission-mode auto`，避免等待确认；
- Kimi Code 的 YOLO/自动确认模式只在对应适配器验证后启用；
- Agent 的过程事件、原始输出和错误全部写入 Run 目录，不依赖终端历史；
- 连续两次相同失败后停止，不无限重试；
- 当前是文件级软隔离，不能证明模型无法读取宿主机其他目录，所以所有运行
  `leaderboard_eligible=false`；
- 正式对外比较前应升级到容器或操作系统级隔离。

## Run 目录与报告

每次运行输出到 `.local/runs/<run-id>/`，重点文件：

```text
run-spec.json
result.json
evaluator-summary.json
browser-evidence.json
isolation.json
input/
logs/stages/<stage-id>/
workspace/
reports/report.html
reports/report.md
reports/report.json
```

HTML 和 Markdown 报告默认使用中文；JSON 保留稳定的英文枚举与字段名，便于后续聚合。

每次真实 Run 结束时，终端会额外打印 `[VAB] 直接查看` 清单：HTML 评测报告、最终交付网页、
交付说明、自动化测试结果、性能证据和 Requirement Ledger 都以可直接打开的 `file://` 地址给出；
同一清单也写入最终 JSON 输出的 `quick_view` 字段。

### 完成 Run 后先看什么

1. `reports/report.html`：评测总览、机器事实、Token、流程门禁和缺失证据；
2. `workspace/dist/index.html`：模型实际生成的、可由浏览器加载的最终构建网页；
3. `workspace/automated-test-results/summary.json`：模型自行留下的构建与测试声明；
4. `artifacts/workspace.diff`：相对初始 Fixture 的完整代码变化；
5. `logs/stages/S0...Sn/`：各阶段 Prompt、原始 stdout/stderr 与归一化事件，用于回溯需求澄清和失败。

不要优先打开 `workspace/index.html`：它可能是引用 `.ts` 源文件的开发入口。应优先打开
`workspace/dist/index.html`。若浏览器对本地 module 有限制，在该工作区启动静态服务后访问：

```bash
cd .local/runs/<run-id>/workspace
npm start
# 浏览器打开 http://localhost:4173
```

`report.html` 的 `success` 只表示流程门禁通过；只有在人工评审补齐后，才会出现可用于管理判断的
业务验收结论。

### 查看是否正在执行

新启动的 `bench:case` 会直接在原终端输出：

- Run ID 和 Run 目录；
- 独立工作区路径；
- 当前阶段和已完成阶段数；
- stdout/stderr 日志大小；
- 至少每 30 秒一次心跳。

已经启动的 Run 可在另一个终端查看。省略 `--run` 时查看最新 Run：

```bash
npm run bench:status
```

持续观察指定 Run：

```bash
npm run bench:status -- \
  --run 2026-07-19T12-39-03-957Z_claude_b186f92b \
  --watch
```

列出最近 Run：

```bash
npm run bench:status -- --list
```

直接查看模型原始流式事件：

```bash
tail -f .local/runs/<run-id>/logs/stages/<stage-id>/stdout.raw
```

不同 Adapter 的 `stdout.raw` 可能是 JSONL 或普通文本；它适合回溯但不适合日常阅读，优先使用
`bench:status --watch`。单个 stdout/stderr 超过 16 MiB 会被截断并将该阶段标记失败，以保护宿主机
内存和磁盘。

### 恢复被额度或限流中断的 Run

恢复命令必须使用原 Run ID；它不会新建 Run，不会重跑已完成阶段，并保留原 workspace 与 CLI Session：

```bash
npm run bench:case -- --resume-run <run-id>
```

对于旧版 Run（只有 `run-spec.json`，没有 `run-state.json`），首次恢复会自动保存
`run-spec.legacy-v2.json` 和 `result.pre-resume.json`，然后仅补齐当前 Runner 所需的状态文件。迁移不删除
旧日志、旧结果或已完成阶段。恢复时不接受新的 `--engine`、`--model` 或预算参数，避免混入不同模型或配置。
恢复后的 `result.json` 会简化已完成阶段的信息；报告生成会自动复用
`logs/stages/<stage-id>/attempt-*/checkpoint-gate.json` 中的原始门禁证据，避免把已通过阶段误判为失败。
`--wall-time-minutes` 限制的是单次实际运行窗口；等待额度恢复、隔夜或暂停期间不计入该窗口。原始
`started_at` 仍保留用于审计，恢复时会另记 `active_window_started_at`。
答案泄漏扫描在 `prepare` 时针对模型尚未执行的 Fixture 进行；恢复阶段不会重新扫描 Agent 已写入的
workspace，以免把正常的需求台账、交付说明等任务文本误判为泄漏。

### 独立目录与文件级隔离

每次运行都会创建：

```text
.local/runs/<run-id>/
├── input/                 # 当前已披露的阶段 Prompt
├── workspace/             # Agent 唯一应操作的独立工作区
│   └── .git/              # 新初始化的基线仓库，不继承答案仓库历史
├── logs/
│   ├── leakage-scan.json  # 运行前答案泄漏扫描
│   └── stages/            # 每阶段 stdout、stderr 和归一化事件
├── artifacts/             # workspace.diff 等机器证据
├── browser-evidence.json  # 浏览器证据（完成真实浏览器采集后覆盖/补齐）
├── human-review.json      # 人工评分、结论和人工投入记录
├── .empty-skills/         # Kimi Skill 隔离目录
├── run-spec.json          # 当前阶段、预算、引擎和隔离信息
└── ISOLATION.md           # 本次隔离能力声明
```

Runner 只把脱敏 `fixture/starter` 复制到 `workspace/`，复制时排除 `.git`、`node_modules`、构建
产物和常见缓存；然后对工作区执行答案泄漏扫描。扫描命中时 Run 不会开始。阶段输入按顺序写入，
不会提前复制未来阶段 Prompt。

但这只是文件级软隔离，不是安全沙箱：

- CLI 进程以当前用户身份运行；
- 为复用登录状态会继承 HOME；
- 理论上仍能通过绝对路径读取宿主机其他目录；
- 当前机制只能证明 Harness 没有主动把答案交给模型，不能证明模型进程绝对无法访问答案仓库。

因此当前运行统一标记 `file-isolated-development` 和 `leaderboard_eligible=false`。需要严格证明
“无法读取宿主机答案”时，必须升级到容器、独立用户或操作系统 Sandbox，并只挂载 Run 的
`workspace/`、必要凭据代理和允许的网络。

已有 Run 可以在不重新调用模型的情况下重新生成中文报告：

```bash
node scripts/generate-report.mjs \
  --run /absolute/path/to/run \
  --out-dir /absolute/path/to/reports \
  --format all \
  --title "股权关系可视化 · DeepSeek V4 Flash 评测报告"
```

加入人工评审文件后再次执行同一命令，即可更新管理结论、人工介入时间、可验收交付率和有效
提效倍数。

如果历史 Run 的 `result.json` 已显示各阶段 checkpoint gate 成功、但旧版后处理器误报“符号型
checkpoint 缺失”，可只重新归档机器证据与报告，不调用模型：

```bash
npm run bench:case -- \
  --finalize-run <run-id 或绝对 Run 目录>
```

## 适配器边界

底层 `bench prepare/run` 与 `bench:case` 均已接入 Codex、Kimi、Claude 和 Pi。各 Adapter 的
非交互确认、Session 连续性、流式事件、超时、预算及失败证据均使用统一 Runner 协议；具体模型
是否完成真实试跑，仍以对应 Run 的 `result.json`、日志和人工评审为准，不能以 Adapter 已接入替代
实际能力结论。

## 记忆效果配对评测

### 实验边界

配对评测只比较一个 `off` Arm 和一个 `approved_only` Arm。除记忆模式和对应干预证据外，两边必须
固定以下控制变量：

- `caseId`、`caseVersion`；
- `model`、`provider`、`engine`、`reasoningEffort`；
- 唯一的 `tools` 列表；
- `budget.wallTimeMinutes`、`maxRetries`、`maxTokens`、`maxCostUsd`；
- 7–64 位十六进制 `baseCommit`；
- 64 位小写 SHA-256 `fixtureHash` 和 `memorySnapshotHash`。

`MemoryExperimentSpec` 顶层字段固定为 `schemaVersion`、`experimentId`、`projectId`、
`taskId`、`arms`、`controls`、`createdAt`，且 `arms` 必须严格为
`["off", "approved_only"]`。预算中 `maxTokens` 可为 `null` 或正整数，`maxCostUsd`
可为 `null` 或非负数。

每个 Arm wrapper 还必须含顶层 `execution`，且只能包含 `sessionId` 与 `workspaceId`。两者均为
1–128 字符 bounded ID（首字符为字母或数字，其余可使用字母、数字、`.`、`_`、`:`、`-`）。
`off` 与 `approved_only` 的 Session 必须不同以证明 fresh session，Workspace 也必须不同以证明
独立执行目录；复用任一项都会拒绝 Pair。

`off` Arm 的 `contextPackHash` 必须为 `null`，且 `selectedMemoryIds=[]`。
`approved_only` 即使没有匹配记忆，也必须记录空 Context Pack 的 SHA-256 hash；其
`selectedMemoryIds` 可以为空，但最多三条。每个 `MemoryIntervention` 还必须记录非空
`retrievalRunId`。ID 命名空间固定为 `memory_intervention_…`、
`memory_retrieval_…` 和 `memory_…`。两种状态不能互换。

反馈可指向某条实际注入的记忆，也可指向整次干预：

- `memoryId` 非空时，必须属于该干预的 `selectedMemoryIds`；
- `memoryId=null` 时，表示 intervention-level feedback；
- `feedbackId` 使用 `memory_feedback_…`；
- `evidenceRefs` 至少一项，且每项使用 `run_…` 或 `artifact_…`；
- 每条 Feedback 证据必须同时存在于本 Arm 的 `result.evidenceRefs`；
- Feedback 契约不含 `source` 字段；
- 孤立、越界或无证据反馈会使契约校验失败，不会被静默忽略。

四份共享契约均使用 camelCase 和 `schemaVersion: 1`：

```text
schemas/memory-experiment-spec.schema.json
schemas/memory-intervention.schema.json
schemas/memory-feedback.schema.json
schemas/memory-paired-report.schema.json
```

### 零费用验证

日常开发和 CI 只使用 deterministic fixture，不启动 Codex、Claude、Kimi、Pi 或外部模型 API：

```bash
npm run test:memory
npm test
```

需要单独检查记忆链路时，显式选择备选 Case `memory-effectiveness-smoke`。它不属于默认主 Case
集合，不进入排行榜，只验证语义化版本历史陷阱、干预、反馈、配对比较和报告接线。
`test:memory` 全程使用本地 fixture，不产生模型调用，并运行正式 Golden Pipeline，要求最终
evaluator 证据为 `control-plane-attested`。

### 生成配对报告

准备两个 Arm JSON。每个文件都必须包含 `experimentSpec`、`execution`、`intervention`、
`feedback` 和 `result`，其中 `result.evidenceRefs` 至少一项：

```bash
node scripts/bench.mjs memory-report \
  --off <off-run.json> \
  --approved-only <approved-only-run.json> \
  --out .local/reports/memory-paired-report.json
```

也可以使用 npm 别名：

```bash
npm run bench:memory-report -- \
  --off <off-run.json> \
  --approved-only <approved-only-run.json> \
  --out <paired-report.json>
```

命令只读取两个源结果并原子写入一个结构化报告，不重新调用模型、不修改源 Run。输入不符合 Schema
或反馈不属于本 Arm 结果证据时，命令非零退出且不保留部分输出。`--out` 不能与任一输入为同一文件，
也不能指向任何既存文件。写入流程先独占创建同目录临时文件，再通过 `linkSync(temp, out)` 做
原子、排他的 no-clobber 发布；两个并发进程竞争同一输出时恰好一个成功。`finally` 在成功或失败后
都会 unlink 临时文件，避免 TOCTOU 覆盖和残留。

### 解释报告

报告字段为：

- `schemaVersion`、`experimentId`、`projectId`、`taskId` 和 `generatedAt`；
- `comparisonStatus`：两臂成功时为 `eligible`，任一失败时为 `ineligible`；
- `armControls`：`caseId`、`caseVersion`、模型/运行时、工具、预算、提交、Fixture 和 Memory
  Snapshot 等每个控制字段均记录为 `matched`；
- `arms`：两边的 `interventionId`、`retrievalRunId`、Context Pack hash、选中记忆和
  `resultStatus`，以及 `sessionId`、`workspaceId`；
- `controls`：已验证为两边完全一致的实验控制；
- `feedbackCounts`：`helpful`、`neutral`、`harmful`、`unobserved` 数量；
- `utilization`：已选记忆中得到可观测反馈的比例；
- `deltas.quality|time|cost`：统一使用 `approved_only_minus_off` 方向；
- `evidenceRefs`：两臂独立结果证据和有效 Feedback 证据的去重集合。

缺证据、同臂输入、控制或 `policyVersion` 不一致、Feedback 引用非本臂结果证据、两臂复用
结果证据、Session 或 Workspace 都属于无效 Pair：命令直接拒绝。合法 Pair 中任一 Arm 的
`result.status=failed` 时，
`comparisonStatus=ineligible`，quality/time/cost 三项 delta 全部为 `unavailable`。两臂均成功时，
某项 `qualityScore`、`durationMs` 或 `costUsd` 缺失才只影响对应 delta；没有选中记忆时
utilization 因无分母标记为 `unavailable`。`unavailable` 不是零，系统不会估算缺失值。
运行时权威校验还要求 utilization 的 `selectedCount` 等于 approved Arm 的实际选中数量，
`observedCount` 不得超过它，reported `rate` 必须等于两者比值（保留六位小数）。JSON Schema
通过 `$comment` 声明这些跨字段不变量，最终以 runtime validator 为准。所有契约时间戳只接受
canonical RFC3339 子集：年份为 `0001`–`9999`，分隔符必须是大写 `T`，时区必须是大写 `Z` 或
数字 `±HH:MM`，小时为 `00`–`23`，秒为 `00`–`59`（禁止 leap second）。Schema `pattern`
执行词法约束，`$comment` 声明 runtime 还会验证真实 Gregorian 日期，因此 lowercase `t/z`、
year `0000`、`2026-02-30`、hour `24` 和 second `60` 都会失败。
Report Schema 用 `$comment` 声明两臂 `sessionId`/`workspaceId` 必须分别不同；跨臂唯一性同样以
runtime validator 为权威。
