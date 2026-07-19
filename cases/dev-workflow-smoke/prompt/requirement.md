# 内部完整需求真相

本文件只供评测方验收，不在 S0 直接提供。

- 页面无需构建，可直接打开；
- `#status-card` 包含 `#smoke-title`、`#smoke-value` 和 `#toggle-status`；
- 标题为 `Pipeline Health`；
- 数值为 `3 / 3 stages`；
- 初始 `data-status="ready"`；
- 点击按钮后在 `ready` 与 `paused` 间切换；
- Agent 持续维护 `requirement-ledger.yaml`；
- 最终存在可执行测试和 `artifacts/smoke-result.json`；
- 不依赖网络、第三方包或真实业务代码。
