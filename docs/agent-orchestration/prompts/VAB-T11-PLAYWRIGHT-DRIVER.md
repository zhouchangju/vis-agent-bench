# VAB-T11：Playwright 真实浏览器证据 Driver

```prompt
你负责 vis-agent-bench 的 VAB-T11，为既有 T06 浏览器证据协议增加真实 Playwright Driver。

工作树路径由总控提供。先读取 AGENTS.md、CONTROL_PROTOCOL、T06 evidence、现有 browser-evidence
模块和 browser-smoke-harness-template 的原则。

允许修改：
- src/browser-evidence/drivers/**
- scripts/capture-playwright-evidence.mjs
- tests/browser-evidence/playwright/**
- docs/architecture/BROWSER_EVIDENCE_PROTOCOL.md
- docs/agent-orchestration/evidence/VAB-T11.md

要求：
1. 在本地 URL 上使用真实 Chromium，采集固定 viewport 截图、console、page errors、关键 DOM/画布
   状态和交互步骤结果；复用 T06 manifest/结构化错误契约。
2. 明确区分 environment/browser 启动失败、navigation 失败、selector/interaction 产品失败。
3. 支持声明式 smoke steps：goto/wait/click/hover/keyboard/resize/screenshot/assert-visible/
   assert-text/collect-state；限制任意代码执行。
4. 测试含一个真实本地静态页成功样例和故意失败样例；产物路径稳定。
5. 不声称自动证明审美或完整视觉正确性；这些仍进入人工评审。
6. 若仓库未安装 Playwright，优先使用环境已有包；确需依赖时只在本任务范围记录集成需求，不修改
   package.json，由总控在 T08 统一处理。

完成后提交一个独立 commit，不 push；回传 commit、命令、证据和 not_proven。
```
