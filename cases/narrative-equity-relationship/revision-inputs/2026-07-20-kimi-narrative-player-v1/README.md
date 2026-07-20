# Narrative Equity：Kimi 叙事播放器修订素材包 v1

## 适用范围

本包对应父 Run `2026-07-19T15-20-08-029Z_kimi_0fcd1e6f` 的补充 Revision。它用于比较提示词生成版与人工基准版的视觉与播放体验差异，不修改正式 Case 的首轮 `scenario/`。

## 核心修订目标

将“有章节按钮、但只是全图淡化的关系图”提升为具备章节镜头聚焦、当前节点/关系重组、字幕、章节说明卡、底部时间线和连贯播放节奏的叙事播放器；同时保持既有数据协议、组件 API、播放控制和基础关系表达能力。

## 文件

- `feedback.md`：原始逐项对比与验收期待。
- `playback-process-comparison.png`：播放过程对比。
- `node-style-comparison.png`：节点层级与样式对比。
- `edge-style-comparison.png`：关系线、箭头和标签对比。
- `playback-focus-comparison.png`：章节聚焦效果对比。

图片仅用于提取视觉、交互和叙事约束；不得复用其中的真实业务内容、文本或素材。实际 Revision Run 会复制这些输入，并以 `revision.json` 记录哈希与父子血缘。
