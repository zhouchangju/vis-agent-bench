# ADR-0001：首批 Case 收敛为三个真实业务切片

## 状态

Accepted，2026-07-19。

## 决策

第一阶段不建设大规模 Case 库，只选择：

- `CAND-3D-001`：Macro Map 从零 3D；
- `CAND-SC-001`：StandardChart 产业链双向树；
- `CAND-SHOT-HEATMAP-001`：AInvest Market Heatmap 已上线业务复刻。

StandardChart TODO / 存量维护类首期暂缓，不加入 Suite。

## 原因

- 平台执行和验收契约尚未跑通；
- Case 质量比数量重要；
- 早期大量 Case 会同时放大 fixture、验收和维护成本；
- 需要先验证需求粒度是否能模拟真实工作。
- 需要优先验证过去真实消耗工程师时间的瓶颈，不用简单题制造虚假高通过率。

## 后续

三个 Case 跑通至少两个模型后，再根据区分度、稳定性和维护成本决定是否扩充。

若某个 Case 被多数模型轻松一次通过，且人工基线本来就很低，则降级为 smoke/calibration，不进入领导提效结论。
