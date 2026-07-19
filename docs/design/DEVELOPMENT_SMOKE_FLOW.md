# 开发阶段快速闭环

## 目的

开发 vis-agent-bench 时，不应每次都调用真实模型、等待复杂可视化实现。开发 smoke flow
只验证平台管道：

> 多阶段输入 → Agent 产物 → checkpoint → 外部日志 → Evaluator → Review → 报告

它不评估任何模型能力，也不能进入排行榜。

## 两层冒烟测试

### L0：确定性 Mock

```bash
npm run smoke:flow
```

- 不联网；
- 不调用 Codex、Kimi 或 Claude；
- 使用固定 mock agent；
- 预计数秒内结束；
- 生成完整 Run 目录和自包含 HTML 报告；
- 所有报告明确标记 `DEMO DATA` 和 `leaderboard_eligible=false`。

用于日常开发、CI 和报告回归。

### L1：真实 CLI

使用 `dev-workflow-smoke` Case 的 starter，通过正式 Runner 选择一个真实 Adapter。该模式
只实现一个极小状态卡片，主要验证 CLI 参数、Session 连续性、真实遥测和权限模式。它会消耗
Token，应按需运行，不作为日常单元测试。

## Smoke Case

`cases/dev-workflow-smoke` 只有三个阶段：

1. S0：理解需求，写 Requirement Ledger 和 POC 计划；
2. S1：实现一个静态状态卡片；
3. S2：根据反馈增加状态切换，并产生测试证据。

最终检查：

- 所有阶段 Prompt 和日志存在；
- 每阶段 checkpoint 完整；
- 最终页面和交互代码存在；
- Evaluator summary、human-review、browser evidence 和 isolation evidence 可加载；
- `report.json` 通过 Report Schema；
- `report.html` 可直接打开且带 DEMO 标识。

## 非目标

- 不验证模型质量；
- 不验证复杂布局、Canvas/WebGL 或视觉审美；
- 不产生可用于领导结论的效率数字；
- 不证明文件级软隔离足够安全。
