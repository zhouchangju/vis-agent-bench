# 视觉反馈 Revision 子 Run

当首轮交付已有可运行代码，但人工评审发现“文字无法表达清楚”的布局、层级、留白、连线或视觉风格问题时，使用 Revision 子 Run，而不是重跑完整 Case 或覆盖原 Run。

## 原则

- 父 Run 不可变：原 workspace、日志、报告和原生会话不被修改。
- 子 Run 从父 workspace 创建 Git baseline；重建产物后再提交本轮变更。
- 新会话、窄上下文：只给模型父代码快照、本次反馈和最多 6 张图片，不继承旧的长对话，避免上下文稀释。
- 图片先于改码：R0 必须先写 `docs/revision/visual-grounding.md`，区分图片事实、推断和不确定项；R1 才能修改代码。
- 不把截图相似度当自动验收：R2 生成比对证据和回归结果，最终视觉结论仍需人工浏览器评审。

## 图片输入适配

- Codex：R0 将参考图以 CLI `--image` 附件传入模型。
- Kimi Code：R0 获得稳定图片路径，并被要求逐张调用 `ReadMediaFile`。
- Claude Code：R0 保留图片路径，依赖其原生 `Read` 图片能力；首次使用某个 CLI 版本时应先用 `--dry-run` 和小图验证。
- Pi：当前保留参考图片和完整过程证据，但尚未验证其 print-mode 对本地图片的原生多模态读取；不要把 Pi 的 Revision 结果视为“已验证图片理解能力”，除非阶段日志证明确实读取了图片。

## 命令

```bash
npm run bench:case -- \
  --revise-run 2026-07-19T15-20-08-029Z_kimi_0fcd1e6f \
  --feedback /absolute/path/feedback.md \
  --reference /absolute/path/reference-1.png \
  --reference /absolute/path/reference-2.png \
  --acknowledge-no-cost-cap
```

`--revise-run` 使用父 Run 的 case、模型、Provider、思考强度和墙钟预算；不要再传 `--engine`、`--model` 或 `--wall-time-minutes`，以免破坏可比性。Claude 父 Run 保留原生单阶段费用上限；Codex、Kimi、Pi 仍需要显式确认其 CLI 没有原生费用上限。

先只检查参数可用：

```bash
npm run bench:case -- \
  --revise-run <parent-run-id> \
  --feedback /absolute/path/feedback.md \
  --reference /absolute/path/reference.png \
  --dry-run
```

## 产物与评审

子 Run 会输出：

- `revision.json`：父 Run、反馈与图片的 SHA-256、会话策略。
- `workspace/.vab/revision-inputs/`：复制后的输入包；参考图片被重命名为 `reference-01.*` 等稳定文件名。
- `workspace/docs/revision/visual-grounding.md`：图片理解与约束提取。
- `workspace/docs/revision/change-log.md`：每项改动、反馈编号、涉及文件和回归验证。
- `workspace/docs/revision/before-after.md`：人工比对入口与未满足项。
- `reports/report.html`：在事实层与证据索引中标注父 Run 血缘。

完成后应先打开终端输出的“最终交付网页”和“修订前后对照”，再补录人工视觉评分、修改耗时与验收结论。这样可以把“模型首版能力”和“给图后的协作修订能力”分开衡量。
