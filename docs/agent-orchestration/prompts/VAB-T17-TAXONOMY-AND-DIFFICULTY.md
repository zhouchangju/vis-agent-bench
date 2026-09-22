# VAB-T17：任务分类与难度分级元数据规范与校验

```prompt
你负责 vis-agent-bench 的 VAB-T17，只实现“任务分类与难度分级元数据规范与校验”。

仓库：当前工作区
建议分支：codex/vab-t17-taxonomy-difficulty

先读取：
- AGENTS.md
- docs/design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md
- docs/agent-orchestration/task-catalog.yaml 中 VAB-T17
- schemas/case.schema.json
- scripts/validate-structure.mjs
- cases/*/case.yaml

目标：
将任务类型规范化为 6 大标准类型（feature-dev, bug-hunting, perf-tuning, reconstruction, greenfield-3d, refactor-migrate），
将难度分级从原粗粒度升级为 4 个明确等级（bronze, silver, gold, diamond），并在契约校验中实现完整约束，同时平滑升级存量 6 个 Case。

依赖：
- VAB-T00

允许修改：
- schemas/case.schema.json
- src/contracts/**
- scripts/validate-structure.mjs
- cases/*/case.yaml
- tests/contracts/**
- docs/agent-orchestration/evidence/VAB-T17.md

禁止：
- 不修改 Evaluator、Runner、Fixture 运行时逻辑。
- 不引入外部大型依赖。

必须交付：
1. 更新 `schemas/case.schema.json`，在 enum 中严格定义：
   - task_type: [feature-dev, bug-hunting, perf-tuning, reconstruction, greenfield-3d, refactor-migrate, development-smoke, memory-effectiveness]
   - difficulty: [bronze, silver, gold, diamond]
2. 更新存量 6 个 Case 的 `case.yaml`，映射为合理的新分类与新分级（如 3D 对应 diamond/greenfield-3d，叙事股权对应 gold/feature-dev 等）。
3. 扩展契约测试 `tests/contracts/**`，增加正例与非法 task_type / difficulty 反例测试。
4. evidence/VAB-T17.md。

验收：
- npm test
- node scripts/validate-structure.mjs
- git diff --check

完成后以 CONTROL_PROTOCOL 的 JSON 结构回传。
```
