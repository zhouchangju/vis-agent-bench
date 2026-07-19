# 开发阶段快速闭环

## 目的

开发 vis-agent-bench 时，不应每次都调用真实模型、等待复杂可视化实现。开发 smoke flow
只验证平台管道：

> 多阶段输入 → Agent 产物 → checkpoint → 外部日志 → Evaluator → Review → 报告

它不评估任何模型能力，也不能进入排行榜。

## 三层运行

### L0：确定性 Mock

```bash
npm run smoke:flow
```

- 不联网；
- 不调用 Codex、Kimi 或 Claude；
- 使用固定 mock agent；
- 预计数秒内结束；
- 生成完整 Run 目录和自包含 HTML 报告；
- 所有报告明确标记“演示数据”和 `leaderboard_eligible=false`。

用于日常开发、CI 和报告回归。

### L1：真实 CLI

使用 `dev-workflow-smoke` Case 的 starter，通过正式 Runner 选择一个真实 Adapter。该模式
只实现一个极小状态卡片，主要验证 CLI 参数、Session 连续性、真实遥测和权限模式。它会消耗
Token，应按需运行，不作为日常单元测试。

当前一键入口默认通过 Claude Code 调用 `deepseek-v4-flash`：

```bash
npm run smoke:flow:real
```

等价的显式配置：

```bash
npm run smoke:flow:real -- \
  --engine claude \
  --model deepseek-v4-flash \
  --provider claude-code-configured-provider \
  --wall-time-minutes 10 \
  --max-stage-cost-usd 0.50
```

真实模式仍然是开发证据：

- `mode=real-model-development-smoke`；
- `leaderboard_eligible=false`；
- 报告强制带“演示数据”标识；
- 自动检查只生成 Evaluator 结果，不伪造人工 Review；
- 报告会明确显示 human review 缺失，不能得出效率或替代性结论。
- Smoke Prompt 禁止子 Agent、后台任务和联网，避免为验证管道产生无关成本；
- Runner 从 stream-json 汇总 reported Token、费用和 observed model，不按文本长度估算。

Claude 的 `--max-budget-usd` 在当前分阶段非交互调用中按单次 Stage 生效，不是整个 Run 总额。
入口因此使用 `--max-stage-cost-usd`；三阶段理论最大费用为该值的三倍。旧的
`--max-cost-usd` 仅作为兼容别名，日志同时记录单阶段上限和理论 Run 上限。

Claude Code 使用 `--print --permission-mode auto` 避免审批等待。多阶段评测需要保存 Session，
因此 Adapter 不得同时传 `--no-session-persistence`。若实际模型配置来自用户侧 Claude
设置，报告只记录 configured provider；除非 CLI 事件能证明实际 provider/model，不能凭模型
别名推断供应商。

### L2：指定正式 Case

同一个入口也可以运行股权关系、3D、热力地图等正式 Case：

```bash
npm run bench:case -- \
  --case narrative-equity-relationship \
  --engine claude \
  --model deepseek-v4-flash \
  --max-stage-cost-usd 2 \
  --wall-time-minutes 180
```

运行前可增加 `--dry-run`，只解析配置，不调用模型。正式 Case 只自动判断编排、checkpoint 和
产物完整性；视觉与业务 P0 保持待评审，不能以“流程跑完”替代人工验收。

完整参数、证据目录和报告重生成方式见
[评测运行手册](../operations/RUNBOOK.md)。

## Smoke Case

`cases/dev-workflow-smoke` 只有三个阶段：

1. S0：理解需求，写 Requirement Ledger 和 POC 计划；
2. S1：实现一个静态状态卡片；
3. S2：根据反馈增加状态切换，并产生测试证据。

最终检查：

- 所有阶段 Prompt 和日志存在；
- 每阶段 checkpoint 完整；
- 最终页面和交互代码存在；
- Evaluator summary、browser evidence 和 isolation evidence 可加载；
- Mock 模式可带合成 Review；真实模式保持 human review 缺失，等待人工评审；
- `report.json` 通过 Report Schema；
- `report.html` 可直接打开且带“演示数据”标识。

## 非目标

- 不验证模型质量；
- 不验证复杂布局、Canvas/WebGL 或视觉审美；
- 不产生可用于领导结论的效率数字；
- 不证明文件级软隔离足够安全。
