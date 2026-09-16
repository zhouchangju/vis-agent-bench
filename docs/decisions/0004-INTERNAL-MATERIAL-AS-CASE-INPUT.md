# ADR-0004：内部产品素材作为基准案例的既定输入

- 状态：Accepted
- 日期：2026-09-15
- 修订范围：AGENTS.md「Security」中的未脱敏截图禁令；CONTROL_PROTOCOL.md §8 中的「未脱敏素材」条款

## 决策

本仓库的基准案例直接源自公司真实需求。内部产品截图、需求原文与 UI 捕获
是案例的既定输入素材，允许随仓库保存与提交，不再要求脱敏。

被移除的规则：

- AGENTS.md：「不得提交含内部信息（人名、邮箱、项目 ID、内部 URL）的未脱敏截图」；
- CONTROL_PROTOCOL.md §8：「不提交……未脱敏素材」。

仍然保留的边界：

- 凭据、Cookie、访问令牌、私有环境文件与原始密钥仍然禁止提交；
- 内部源码快照仍需显式的 sanitization 决策；
- `.local/` 作为本地运行状态目录继续被 gitignore，其中内容默认不进入版本库。

## 原因

案例的有效性依赖真实需求上下文；对截图与需求素材脱敏会破坏案例的代表性。
这些素材本身就是项目的工作产物，随项目流转是其用途的一部分，而非意外泄漏。

pre-transfer-privacy-gate 的扫描配置（`config/privacy/transfer-scan-profile.json`）
相应静音两类规则，使后续转移扫描不再将其列为问题：

- `personal-record:interview-material`：截图与候选案例文档按 ADR-0004 属既定输入；
- `personal-context:personal-finance`：对本项目属功能性词汇误报
  （「机构持仓」等是图表案例名，不是私人理财记录）。
