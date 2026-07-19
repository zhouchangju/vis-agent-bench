# VAB-T03：股权关系脱敏 Fixture

```prompt
你负责 vis-agent-bench 的 VAB-T03，只建设股权关系主 Case 的脱敏可运行起始工程。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t03-equity-fixture
依赖：VAB-T02 已合入。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- cases/narrative-equity-relationship/source-analysis.md
- cases/narrative-equity-relationship/prompt/requirement.md
- cases/narrative-equity-relationship/scenario/stages.yaml
- cases/narrative-equity-relationship/fixture/README.md
- Fixture Framework 接口

来源仓库 `/Users/leozhou/git/narrative-graph` 只允许按需只读核对，不得修改，不得复制实现、
测试、唯一类名、提交历史、真实实体或内部素材。优先依据已提取文档工作。

允许修改：
- cases/narrative-equity-relationship/fixture/**
- scripts/fixtures/equity/**
- tests/cases/narrative-equity/**
- docs/agent-orchestration/evidence/VAB-T03.md

目标：
生成一个无答案、可编译、可启动的 TypeScript 可视化脚手架和脱敏业务输入，使被测 Agent
从零实现组件，但不把任务变成搭建基础工程或修依赖。

必须交付：
1. 最小可运行前端工程，只有通用 shell、测试入口和空组件接口，不含答案算法。
2. 20–30 个总览节点、4 个章节、每章 3–5 step 的脱敏 DSL。
3. 覆盖三类节点、三种关系方向、长名称、长关系文本、异常引用和缺失素材样本。
4. 覆盖 fade/scale/opacity/grow/move/replace/group/group_grow/ungroup 的输入，但不含实现。
5. 合法、非法、边界 fixture 分离；可公开内容与隐藏样本分离。
6. 本地占位图、截图和音频素材必须原创/程序生成/可公开，不使用内部原件。
7. build/typecheck/test baseline 通过，泄漏扫描为 0。
8. manifest 记录来源类型、hash、生成命令和允许暴露文件。

禁止硬编码预期布局坐标或答案截图到模型可见区。验收：
- Fixture Framework 构建命令
- fixture 自身 build/typecheck/test
- leakage scan
- npm test
- git diff --check

完成后只提交本任务文件，不 push；evidence 必须声明来源仓库未修改及尚未证明的视觉质量。
```

