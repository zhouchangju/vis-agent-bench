# ADR-0002：评测产品收敛过程，而不是一次性编码

## 状态

Accepted，2026-07-19。

## 背景

团队当前已经广泛使用 Codex 等 AI 编码工具。真实可视化研发中，主要人工成本经常不是
敲代码，而是：

- 与产品、设计和业务共同澄清尚不明确的需求；
- 准备上下文、Spec 和任务拆分；
- 对 POC 做视觉、交互和业务走查；
- 反复完成微小调整并处理回归。

完整上下文一次性投喂又可能造成注意力稀释。只测试“完整 Spec → 代码”会高估模型对
真实交付的影响，也无法判断 Kimi K3 是否优于团队已有工作流。

## 决策

1. 主 Case 使用 progressive disclosure；
2. 初始只提供模糊业务 Brief，后续按 POC 和评审节奏披露约束；
3. Agent 每阶段维护 Requirement Ledger；
4. 标准回归使用固定 stakeholder packets，探索运行允许真实人工输入；
5. 主比较基线为“工程师 + Codex + 当前主力 GPT”，纯人工只作补充；
6. 核心结果为 Accepted Delivery、Human Touch Time、First POC Fitness、
   Requirement Retention 和 Iteration Tax。

## 影响

- 完整 `prompt/requirement.md` 转为内部需求真相，不在 T0 投喂；
- Runner 必须支持同一会话的分阶段执行与 checkpoint；
- 人工评审必须把澄清、上下文准备、微调和修复时间分开；
- 领导报告不能用编码速度或漂亮 Demo 单独证明“大幅提效”。

