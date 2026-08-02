## 摘要

<!-- 一两句话说明本 PR 做了什么，以及为什么。 -->

## 变更类型

- [ ] 文档 / 结构（`docs/`、`cases/`、`schemas/`、README、AGENTS.md）
- [ ] 平台代码（`src/`、`scripts/`）
- [ ] 测试（`tests/`）
- [ ] CI / 仓库元数据（`.github/`、`package.json`）
- [ ] 其他：

## 自检清单

请在提交前确认以下各项（不符合的请说明原因）：

- [ ] 已本地运行 `npm test` 并全部通过。
- [ ] 如改动了 `cases/`，已获得 Case 治理批准；候选仍在 `docs/candidates/`，未直接落入 `cases/`。
- [ ] 如改动了 `schemas/` 或契约字段，已说明向后兼容性影响（新增 / 破坏性 / 兼容性别名）。
- [ ] 未提交任何凭证、Cookie、access token、`.env` 文件或未脱敏的内部截图（见 `AGENTS.md` 安全要求）。
- [ ] 如改动了模型可见 prompt 或隐藏断言，已确认断言未泄漏到模型可见层。
- [ ] 如改动了结构化脚本输出，仍保留 `status` / `summary` / `next_actions` / `artifacts` 契约。

## CI 说明

- 推送到 `main` 或面向 `main` 的 PR 会自动触发 `.github/workflows/ci.yml`。
- CI 不跑需要真实模型 API / CLI 的步骤（`smoke:flow:real`、`bench:case`、`bench:doctor`）；这些仍需本地或专人运行。
- 浏览器证据 job 会在 CI 中安装 Playwright Chromium；如本 PR 改动了 `src/browser-evidence/`，请确认其仍可在无头环境下运行。
