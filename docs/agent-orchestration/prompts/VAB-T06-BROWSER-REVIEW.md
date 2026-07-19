# VAB-T06：浏览器证据与人工评审

```prompt
你负责 vis-agent-bench 的 VAB-T06，只实现浏览器证据采集和人工评审数据入口。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t06-browser-review
依赖：VAB-T00 已合入。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- docs/design/HUMAN_REVIEW_WORKFLOW.md
- schemas/human-review.schema.json
- prototype/review.html
- prototype/assets/review.js

允许修改：
- src/browser-evidence/**
- src/review/**
- scripts/capture-browser-evidence.mjs
- tests/browser-evidence/**
- prototype/review.html
- prototype/assets/review.js
- schemas/human-review.schema.json
- docs/agent-orchestration/evidence/VAB-T06.md

目标：
将视觉可视化任务的页面状态、交互轨迹、截图和人工判断结构化保存，不能用截图相似度代替
人的业务视觉判断。

必须交付：
1. 可配置 URL、视口、等待条件、动作序列和截图点的采集协议。
2. console error、page error、网络失败、截图、DOM 摘要和动作日志。
3. 评审页能读取一个 Run 的机器证据，填写布局、视觉、交互、叙事和人工分钟数。
4. 支持保存草稿和导出符合 Schema 的 human-review.json。
5. 区分 blind review 字段与会暴露模型身份的字段。
6. 页面加载失败、selector 缺失和动作超时返回结构化错误。
7. 使用本地静态 fixture 测试，不访问真实业务站点。

不要实现最终领导报告，也不要修改 setup 页或 bench.mjs。验收：
- 本任务测试
- 静态 fixture 浏览器采集冒烟
- human-review Schema 正反例
- npm test
- git diff --check

完成后提交本任务文件并按统一 JSON 回传；明确哪些浏览器和 Canvas/WebGL 检查尚未证明。
```

