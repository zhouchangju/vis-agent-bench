# VAB-T10：AInvest Heatmap 脱敏 Fixture

```prompt
你负责 vis-agent-bench 的 VAB-T10，只实现 AInvest Market Heatmap 主 Case 的脱敏 Fixture。

工作树路径由总控提供。依据仓库内该 Case 的 requirement/scenario/rubric/provenance；公开行为参考为
https://www.ainvest.com/market/heatmap/，不得抓取或复制生产站点代码、接口、品牌资产或真实答案。

允许修改：
- cases/ainvest-market-heatmap-rebuild/fixture/**
- scripts/fixtures/heatmap/**
- tests/cases/ainvest-heatmap/**
- docs/agent-orchestration/evidence/VAB-T10.md

交付可运行的最小 Starter、完全合成的行业/股票层级数据、涨跌/市值/成交量等指标、空值与极值边界
数据、隐藏非法输入、fixture plan、验证脚本和测试。Starter 必须 build/typecheck/test 可运行，
但不得实现最终 treemap。数据应足以验证面积权重、颜色尺度、层级钻取、tooltip、筛选、搜索、
legend、resize、空态和高密度标签。所有资源本地生成，泄漏扫描为 0。

完成后提交一个独立 commit，不 push；回传 commit、命令、证据和 not_proven。
```
