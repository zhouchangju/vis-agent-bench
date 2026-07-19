# VAB-T00：契约与结构校验

```prompt
你负责 vis-agent-bench 的 VAB-T00，只实现“契约与结构校验”。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t00-contracts

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- docs/agent-orchestration/task-catalog.yaml 中 VAB-T00
- cases/*/case.yaml
- cases/*/scenario/stages.yaml
- config/run-profile.example.yaml
- scripts/validate-structure.mjs

目标：
把 Case、Scenario、RunSpec 和标准工具结果从宽松约定升级为可执行契约，使无效输入在运行
模型前失败，并保持现有 3 个 primary + 1 个 backup Case 全部通过。

允许修改：
- schemas/**
- src/contracts/**
- scripts/validate-structure.mjs
- tests/contracts/**
- package.json
- docs/agent-orchestration/evidence/VAB-T00.md

禁止：
- 不修改 cases 内容来迁就校验器。
- 不修改 Runner、Fixture、Evaluator、prototype。
- 不引入完整 Web 框架。

必须交付：
1. Case、Scenario、RunSpec、标准 Result Envelope 的 Schema。
2. 一个窄而稳定的契约校验模块。
3. 正例：当前全部 Case 和示例配置通过。
4. 反例：缺字段、重复 stage、非法 suite_role、错误权重、未来阶段提前暴露等失败。
5. 校验错误返回 status/summary/next_actions/artifacts，并包含定位路径。
6. evidence/VAB-T00.md。

验收：
- npm test
- 新增的契约测试命令
- git diff --check

若必须修改 allowed paths 外的入口，停止并返回 NEEDS_INTEGRATION_CHANGE。
完成后只提交本任务文件，不 push。最终以 CONTROL_PROTOCOL 的 JSON 结构回传，并明确
not_proven。
```

