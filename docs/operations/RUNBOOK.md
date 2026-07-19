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

可指定的现有 Case：

- `narrative-equity-relationship`：股权关系叙事可视化，主 Case；
- `macro-map-3d-greenfield`：从零 3D 场景，主 Case；
- `ainvest-market-heatmap-rebuild`：AInvest 热力地图复刻，主 Case；
- `standard-chart-two-way-tree`：产业链双向树，备选；当前缺少 Starter Fixture，不能直接运行；
- `dev-workflow-smoke`：平台开发专用，不评估复杂可视化能力。

默认优先使用 `cases/<case-id>/fixture/starter`；不存在时使用 `fixture`。也可显式覆盖：

```bash
--workspace-source /absolute/path/to/sanitized-fixture
```

正式 Case 必须显式提供 `--max-stage-cost-usd`，防止无人值守运行失控。默认总墙钟上限为
180 分钟；开发 Smoke 默认 10 分钟。

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

## 适配器边界

底层 `bench prepare/run` 已有 Codex、Kimi、Claude 的统一 Runner 协议；`bench:case` 当前只
开放已经过真实验证的 Claude 入口。Kimi 或 Codex 的一键正式入口应在完成以下验证后开放：

- 非交互确认和权限策略；
- Session 连续性；
- 流式事件与退出码；
- Token、费用和实际模型信息；
- 超时、预算和失败恢复。
