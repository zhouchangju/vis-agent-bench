# 隐藏验收

## P0

- S0、S1、S2 的 Prompt、日志和 checkpoint 证据完整；
- Requirement Ledger、POC 计划、页面、交互脚本和测试结果存在；
- 页面包含规定选择器与固定文案；
- `app.js` 实现 ready/paused 切换；
- `artifacts/smoke-result.json` 表示测试通过；
- Run、Evaluator、Review、Isolation、Browser Evidence 可被报告层加载；
- JSON、Markdown 和 HTML 报告成功生成，HTML 明确标记 DEMO。

## 关键失败

- 调用了真实模型却被标记成 mock；
- 报告未标记 DEMO 或误标为排行榜有效；
- 缺失阶段日志仍宣称完整成功；
- Agent 自述被当成唯一验收证据。
