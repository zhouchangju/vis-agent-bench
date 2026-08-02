# vis-agent-bench

面向真实数据可视化研发工作的 AI Agent 评测与生产力回归平台。

项目不只比较“裸模型回答质量”，而是比较：

> 模型 + CLI / 客户端 / API + 工具权限 + 上下文 + 自动验收

能否在相同真实任务、相同质量门槛下减少人工投入，并稳定产出可交付结果。

## 当前阶段

当前已完成 `M2` 确定性总集成和首轮真实模型 Pilot，正在补齐人工视觉评审、
Human Touch Time 与同口径基线，形成可用于人效判断的完整证据链。

首批范围已收敛为：

1. 从真实 Macro Map 项目中抽取一个“从零 3D”Case；
2. 从真实 Narrative Graph 项目中抽取“股权关系叙事可视化”Case；
3. 复刻已上线的 AInvest Market Heatmap，测试视觉、业务映射、交互与工程完整性。

StandardChart 产业链双向树保留为备选 Case；StandardChart TODO / 存量维护类首期不做，
待三个主 Case 跑通后再决定是否进入下一期。

## 文档入口

- [产品目标](docs/product/PRD.md)
- [总体架构](docs/architecture/ARCHITECTURE.md)
- [隔离与防答案泄漏](docs/architecture/ISOLATION_AND_ANTI_CHEATING.md)
- [CLI Runner 统一协议](docs/architecture/RUNNER_PROTOCOL.md)
- [需求粒度规范](docs/design/REQUIREMENT_GRANULARITY.md)
- [迭代式需求收敛协议](docs/design/ITERATIVE_REQUIREMENT_LOOP.md)
- [人效评估设计](docs/design/EFFICIENCY_EVALUATION.md)
- [Run 日志规范](docs/design/RUN_LOG_SPEC.md)
- [人工评审与最终报告](docs/design/HUMAN_REVIEW_WORKFLOW.md)
- [视觉反馈 Revision 子 Run](docs/design/VISUAL_FEEDBACK_REVISION.md)
- [开发阶段快速闭环](docs/design/DEVELOPMENT_SMOKE_FLOW.md)
- [首轮开发与真实模型运行复盘](docs/retrospectives/2026-07-19-20-DEVELOPMENT-RETROSPECTIVE.md)
- [评测运行手册：测试、真实模型与指定 Case](docs/operations/RUNBOOK.md)
- [多 Agent 开发总控](docs/agent-orchestration/README.md)
- [可直接派发的任务目录](docs/agent-orchestration/task-catalog.yaml)
- [首批候选池](docs/candidates/README.md)
- [路线图](docs/roadmap/ROADMAP.md)
- [运行设置页原型](prototype/setup.html)
- [人工评审页原型](prototype/review.html)
- [领导报告页原型](prototype/report.html)

## 目录

```text
vis-agent-bench/
├── cases/                 # 已批准的正式 Case；候选不得直接进入
├── config/                # 模型、Runner 和 Suite 配置
├── docs/
│   ├── architecture/      # 系统架构
│   ├── candidates/        # 待选择候选
│   ├── decisions/         # 关键决策记录
│   ├── design/            # Case、Prompt、验收和指标规范
│   ├── product/           # PRD
│   ├── reports/           # 报告规范
│   └── roadmap/           # 实施计划
├── schemas/               # 后续的结构化契约
├── scripts/               # CLI、Runner、Evaluator 和校验脚本
├── src/                   # 平台实现
└── tests/                 # 平台自身测试
```

## 基本原则

- 真实需求优先于合成题；
- 真实瓶颈优先于容易获得高通过率的简单题；
- 达到业务质量门槛后才计算提效；
- 模型可见需求与内部验收规范分离；
- 模糊 Brief、POC 反馈和生产化要求按真实节奏逐步披露；
- 主基线是团队当前 Codex + 主力 GPT 工作流，而不是纯人工手写；
- 确定性门禁优先于 Judge 模型打分；
- 失败结果同样保留证据；
- 内部代码和敏感截图不得直接进入公开 fixture；
- 所有结论必须能回溯到 Run、Case、模型配置和代码版本。

## 持续集成

推送到 `main` 或面向 `main` 的 Pull Request 会触发 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。
所有 job 都在 Node 20 / `ubuntu-latest` 上运行，并使用 `npm ci` 安装依赖。每个 job 的 npm 缓存通过
`setup-node` 的 `cache: 'npm'` 复用。

CI 运行的 job：

- **lint-and-structure** — `npm run validate:structure` + `npm run test:syntax`
- **test-core** — `test:contracts` / `test:runners` / `test:fixtures` / `test:cases` / `test:reporting` /
  `test:revision`
- **test-evaluators** — `test:evaluators`（不调用真实模型）
- **test-e2e** — `test:e2e`（端到端 harness 检查，仍为确定性）
- **test-smoke-flow** — `test:smoke-flow`（开发 smoke，不调真实 CLI）
- **test-browser** — `test:browser`；CI 会先 `npx playwright install --with-deps chromium`
  装好无头浏览器，因为 Playwright 不在 `package.json` 的 dependencies 中（由
  `src/browser-evidence/drivers/playwright-loader.mjs` 动态加载）

CI **刻意跳过**以下需要真实 API key / 真实 CLI、或会消耗费用的命令，它们仍需本地或专人运行：

- `smoke:flow:real`
- `bench:case`
- `bench:doctor`

PR 必须 CI 全绿才能合并（GitHub 默认分支保护行为）。本地推荐在推送前跑：

```bash
npm test
```

如本地缺 Playwright，可只跑非浏览器子集，例如 `npm run test:contracts && npm run test:runners`。

## 本地校验

```bash
npm test
```

不调用真实模型、在数秒内验证“多阶段输入 → checkpoint → 日志 → 评估 → HTML 报告”：

```bash
npm run smoke:flow
```

该命令只产生带“演示数据”标识的开发证据，不进入模型比较或正式排行榜。

按需使用真实 Claude Code 模型验证同一闭环（默认模型为 `deepseek-v4-flash`）：

```bash
npm run smoke:flow:real
```

可覆盖模型和费用上限：

```bash
npm run smoke:flow:real -- \
  --model deepseek-v4-flash \
  --max-stage-cost-usd 0.50
```

这里的费用上限是每个阶段的 Claude CLI 上限；三阶段理论 Run 上限为其三倍。
旧参数 `--max-cost-usd` 暂时保留为兼容别名。

指定正式 Case 使用同一套真实模型流程。建议先用 `--dry-run` 零费用检查配置：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine claude \
  --model deepseek-v4-flash \
  --max-stage-cost-usd 2 \
  --wall-time-minutes 180 \
  --dry-run
```

确认后移除 `--dry-run` 即可运行。正式 Case 的流程门禁通过不代表业务验收通过；报告会保持
P0 待评审，直到补齐浏览器证据和人工评审。完整说明见
[评测运行手册](docs/operations/RUNBOOK.md)。

生成的 HTML、Markdown 和管理结论文案默认使用中文；JSON 字段名和枚举保持稳定，便于程序处理。

使用 Kimi K3：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine kimi \
  --model kimi-code/k3 \
  --wall-time-minutes 180 \
  --acknowledge-no-cost-cap
```

Kimi CLI 没有原生费用上限，必须显式确认这一点；建议先增加 `--dry-run` 做零费用配置检查。
所有参数的含义和默认值见[评测运行手册](docs/operations/RUNBOOK.md#参数说明)。

使用 Codex 测试 GPT-5.6 Sol，并固定思考强度：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine codex \
  --model gpt-5.6-sol \
  --reasoning-effort medium \
  --wall-time-minutes 180 \
  --acknowledge-no-cost-cap
```

建议先附加 `--dry-run`；Codex 的思考强度可用 `low`、`medium`、`high`、`xhigh`。

使用 Pi 直连 DeepSeek：

```bash
export DEEPSEEK_API_KEY='…'

npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine pi \
  --model deepseek-chat \
  --model-provider deepseek \
  --wall-time-minutes 180 \
  --acknowledge-no-cost-cap
```

Pi 使用精简的 print 输出、`--approve` 和受限内置工具运行；阶段间通过隔离目录中的会话续跑。它当前
没有可由 Harness 强制的原生费用上限，建议先加入 `--dry-run` 确认模型和 Provider 配置。

运行中查看阶段、日志增长和独立工作区：

```bash
npm run bench:status -- --run <run-id> --watch
```

当模型额度或临时 429 中断时，恢复同一个 Run（保留已完成阶段、workspace 与原生 Session）：

```bash
npm run bench:case -- --resume-run <run-id>
```

首轮运行已产出可用代码、但人工发现视觉表达或布局仍需按参考图微调时，不要覆盖或重跑父 Run；创建视觉反馈 Revision 子 Run。它复制父代码快照、使用新会话处理窄上下文，并保留父子血缘和图片哈希：

```bash
npm run bench:case -- \
  --revise-run <parent-run-id> \
  --feedback /absolute/path/feedback.md \
  --reference /absolute/path/reference-1.png \
  --reference /absolute/path/reference-2.png \
  --acknowledge-no-cost-cap
```

完整流程与产物说明见[视觉反馈 Revision 子 Run](docs/design/VISUAL_FEEDBACK_REVISION.md)。

每次运行都创建 `.local/runs/<run-id>/workspace`，但当前只是文件级软隔离，不能阻止同一用户权限
下的 CLI 通过绝对路径读取宿主机其他目录，因此不进入正式排行榜。

## Runner MVP

检查本机 CLI：

```bash
npm run bench:doctor
```

准备一次文件级软隔离、分阶段 Run：

```bash
node scripts/bench.mjs prepare \
  --case macro-map-3d-greenfield \
  --engine kimi \
  --model kimi-code/k3
```

`run` 会在同一 CLI 会话中依次执行 S0 模糊 Brief、需求对齐、POC 反馈和生产化
阶段；每阶段单独保留日志和 checkpoint。命令会返回 Run 目录和下一步运行命令。首期隔离等级为
`file-isolated-development`，不具备操作系统级防读取保证，也不进入正式排行榜。

运行设置页生成的 schema v2 RunSpec 与 CLI 使用同一契约。CLI 已统一接入：

```bash
node scripts/bench.mjs validate --spec config/run-profile.example.yaml
node scripts/bench.mjs prepare --spec config/run-profile.example.yaml
node scripts/bench.mjs prepare-bundle --bundle vis-agent-bench-run-spec-bundle.json
node scripts/bench.mjs build-fixture --case narrative-equity-relationship --run-dir <run-dir>
node scripts/bench.mjs run --run-dir <run-dir>
node scripts/bench.mjs evaluate --run-dir <run-dir>
node scripts/bench.mjs capture --capture-spec <capture.json> --out-dir <dir> --allow-origin <origin>
node scripts/bench.mjs report --run-dir <run-dir>
```

真实 CLI Run 会记录实际 CLI 版本、阶段日志、归一化事件、原生 Token/费用字段（CLI
不提供时明确标记 `unavailable`）、文件快照、Git diff 和人工评审占位。

## 记忆效果配对评测

Memory Effectiveness Benchmark 用两个受控 Arm 判断项目记忆是否带来可归因变化：
`off` 完全关闭记忆，`approved_only` 最多注入三条已审批记忆。两边的 model、provider、
engine、reasoning effort、工具、预算、Case ID/版本、基础提交、Fixture hash 和 Memory
Snapshot hash 必须完全一致。缺少结果证据、同臂输入、控制变量不一致、Feedback 引用非本臂证据
或复用两臂证据都会被拒绝，不会生成报告。每个输入还必须提供
`execution.{sessionId,workspaceId}`；两臂必须使用不同 Session 和不同 Workspace。

每个输入 JSON 包含 `experimentSpec`、`execution`、`intervention`、`feedback` 和 `result`。
生成结构化报告：

```bash
npm run bench:memory-report -- \
  --off <off-run.json> \
  --approved-only <approved-only-run.json> \
  --out .local/reports/memory-paired-report.json
```

报告固定包含 Schema/实验/项目/任务身份、`comparisonStatus`、每字段均为 `matched` 的
`armControls`、带 `resultStatus` 的 `arms`、`controls`、`feedbackCounts`、`utilization`、
其中 `arms` 保留每臂的 `sessionId`/`workspaceId`；
`deltas.{quality,time,cost}`、`evidenceRefs` 和 `generatedAt`。任一 Arm 失败时比较为
`ineligible`，三项 delta 全部不可用；两个 Arm 均成功时，只有实际缺失的指标才标记为
`unavailable`。

`memory-effectiveness-smoke` 是显式选择的备选 Case，不进入默认主榜。契约、Case、比较和 CLI
测试全部使用 deterministic fixture；`npm run test:memory` 不调用外部模型，也不会产生模型费用。
当前专项门禁为 16/16；它还通过正式 Golden Pipeline 验证 `control-plane-attested` 证据。
所有共享契约时间戳使用严格 canonical RFC3339：非零四位年份、大写 `T`/`Z`（或数字时区偏移）、
真实 Gregorian 日期，且不接受 `24` 时或闰秒。
完整契约和操作步骤见
[评测运行手册](docs/operations/RUNBOOK.md#记忆效果配对评测)。

## 确定性 Golden Run

在调用收费模型前，可用本地 fake adapter 验证三类 Case 的完整控制链路：

```bash
node scripts/bench.mjs golden \
  --spec config/run-profile.example.yaml \
  --out-root .local/acceptance \
  --run-id golden-smoke
```

该命令执行 RunSpec 校验、脱敏 Fixture、分阶段假运行、真实 Chromium 证据、带完整性
绑定的 Evaluator、人工评审占位和 HTML 报告。它只证明 Harness 接线，不代表任何真实模型
能力结论；Golden 结果始终标记为 conclusion-ineligible。失败后可使用同一 `run-id` 加
`--resume` 复用已完成 checkpoint。
