# 面向领导问题的人效评估设计

## 要回答的不是“AI 会不会写”

领导真正需要判断的是：

1. AI 能否完成我们真实业务中的高成本可视化工作；
2. 相比当前 Codex + 主力 GPT 工作流，候选模型是否真正减少总人工投入；
3. 是否减少需求澄清、上下文准备、Review、微调和返工，而不只是缩短编码；
4. 哪类工作可直接交给 Agent，哪类只能辅助，哪类暂时不适合；
5. 推广后能否减少排期瓶颈，而不是只增加 Demo 数量。

## 质量门槛优先

不能用低质量的“首次生成速度”证明提效。

先判断：

- P0 是否完整；
- 业务语义是否正确；
- 是否通过视觉、交互、性能和回归门禁；
- Reviewer 是否愿意合入或交给业务验收。

质量不达标时，时间再短也不计为成功交付。

## 需要记录的时间

### 人工基线

- 需求澄清；
- 方案设计；
- 编码；
- 联调；
- 视觉走查与返工；
- 测试与缺陷修复；
- Review 和上线准备。

### Agent 路径

- 人工解释模糊需求和准备上下文；
- 人工与 Agent 共同澄清、写 Spec 和拆任务；
- Agent 自主运行；
- 人工回答澄清问题；
- 人工视觉/交互 Review；
- 人工发起微调、补救和回归修复；
- 验收与上线准备。

### 时间必须分桶

- `clarification_minutes`：需求讨论与回答问题；
- `context_prep_minutes`：找文件、整理数据、写 Prompt/Spec；
- `poc_review_minutes`：首版 POC 走查；
- `micro_adjustment_minutes`：视觉、文案、布局和交互细调；
- `fix_minutes`：功能错误、回归和工程问题修复；
- `final_review_minutes`：最终业务与代码验收；
- `agent_active_minutes` / `agent_wait_minutes`：机器执行与排队等待，单独展示。

## 核心指标

### Accepted Delivery Rate

达到 P0 且通过质量门槛的运行比例。未达到门槛的结果不能进入提效计算。

### Human Touch Time

Agent 路径中工程师实际投入的分钟数。报告必须展示分桶，避免“编码省了很多”
掩盖“需求和返工投入没有下降”。

### Time to Shared Understanding

从 S0 开始到 Requirement Ledger 的 P0 范围得到确认所需时间与轮数。

### Time to First Reviewable POC

从 S0 到出现可由业务方实际评审的首版所需时间。只会生成漂亮但无法承载真实数据
或交互的 Demo，不计为 reviewable POC。

### First-pass Fitness

首个 POC 已满足的最终 P0 约束比例，以及人工视觉/业务首轮评分。

### Requirement Retention

已披露 `must` 约束在后续版本中持续满足的比例。同步报告：

- must-have 遗漏数；
- 已完成要求的回归数；
- 因上下文误解导致的修正轮数；
- Requirement Ledger 声明与实际实现不一致数。

### Iteration Tax

达到验收前的反馈轮数、微调项数、重复反馈项数和人工微调分钟数。

### End-to-End Lead Time

从任务开始到达到可合入/可验收状态的自然时间。

### Rework Ratio

人工修复代码量或修复时间，占最终交付的比例。

### Effective Speedup

`人工基线总工时 / Agent 路径 Human Touch Time`

必须同时展示 Accepted Delivery Rate，避免失败运行被“零人工”错误计算成高提效。

主比较公式为：

`当前 AI 协作基线 Human Touch Time / 候选模型 Human Touch Time`

纯人工基线只能作为补充。若候选与当前基线差异很小，应明确结论为“模型替换不构成
显著提效”，即使两者都比纯手写快。

### Cost per Accepted Delivery

API 费用、可获得的 Token 成本、机器时间和人工成本之和。客户端无法提供 Token 时标记 `unavailable`，不能估算成精确值。

## 报告判断

- **可替代交付**：P0 稳定通过，人工只需常规 Review；
- **高价值辅助**：不能独立交付，但显著减少编码或定位时间；
- **有限辅助**：需要大量返工，提效主要发生在局部；
- **暂不适用**：质量不稳定或人工接管成本接近/超过基线。

最终报告按任务类型给结论，不用一个总分宣称某个模型“全面最好”。

## 编码加速的理论上限

用 Amdahl 视角解释“编码更快”为什么不等于“总交付大幅提效”：

`总加速比 = 1 / ((1 - 编码占比) + 编码占比 / 编码加速倍数)`

示例：如果编码只占总人工的 30%，即使编码速度提高 2 倍，总人工理论上也只提高约
1.18 倍。正式报告必须使用真实时间记录，不预填这个占比。
