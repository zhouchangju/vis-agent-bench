# VAB-T05：股权关系确定性 Evaluator

```prompt
你负责 vis-agent-bench 的 VAB-T05，只实现股权关系主 Case 的确定性 Evaluator。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t05-equity-evaluator
依赖：VAB-T03、VAB-T04 已合入。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- cases/narrative-equity-relationship/prompt/requirement.md
- cases/narrative-equity-relationship/evaluator/acceptance.md
- cases/narrative-equity-relationship/evaluator/rubric.yaml
- Equity Fixture 和 Evaluator Core API

允许修改：
- src/evaluators/cases/narrative-equity/**
- tests/evaluators/narrative-equity/**
- cases/narrative-equity-relationship/evaluator/**
- docs/agent-orchestration/evidence/VAB-T05.md

目标：
把隐藏验收中的确定性部分变成可执行检查；主观审美保留给人工评审，不伪装成机器真相。

优先实现：
1. build/typecheck/test 与合法/非法 DSL。
2. 总览渲染、事件 payload 和无 uncaught error。
3. 固定视口下节点严重重叠、边穿节点、端点边界、长标签占位。
4. direct chapter entry 与顺序播放到同章的状态等价。
5. fade/opacity/replace/group/ungroup 的终态与重绘保持。
6. play/pause/seek/next/previous/rapid navigation 的确定状态。
7. Resize 后状态保持和 destroy 后无回调。
8. hard gates、rubric check ID 与实际检查一一对应。

要求：
- 使用隐藏 fixture，不将断言或答案复制到模型 workspace。
- 容差有业务解释，不对某个实现细节或 DOM 类名过拟合。
- “讲得清、镜头舒服、动画是否炫技”等保留人工走查。
- 每项失败给出可定位证据和截图/状态快照路径。

验收：
- 本任务测试
- 在故意错误的参考样例上证明检查会失败
- 在最小合规测试实现或测试 doubles 上证明检查可通过
- npm test
- git diff --check

完成后只提交本任务文件，不 push；not_proven 必须列出仍需人工判断的视觉项。
```

