# vis-agent-bench

面向真实数据可视化研发工作的 AI Agent 评测与生产力回归平台。

项目不只比较“裸模型回答质量”，而是比较：

> 模型 + CLI / 客户端 / API + 工具权限 + 上下文 + 自动验收

能否在相同真实任务、相同质量门槛下减少人工投入，并稳定产出可交付结果。

## 当前阶段

当前处于 `M2：分阶段 CLI Runner 与首轮端到端试验`。

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
- [开发阶段快速闭环](docs/design/DEVELOPMENT_SMOKE_FLOW.md)
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
  --model kimi-k3-example
```

`run` 会在同一 CLI 会话中依次执行 S0 模糊 Brief、需求对齐、POC 反馈和生产化
阶段；每阶段单独保留日志和 checkpoint。命令会返回 Run 目录和下一步运行命令。首期隔离等级为
`file-isolated-development`，不具备操作系统级防读取保证，也不进入正式排行榜。
