# VAB-T04：Evaluator Core

```prompt
你负责 vis-agent-bench 的 VAB-T04，只实现通用确定性 Evaluator Core。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t04-evaluator-core
依赖：VAB-T00 已合入。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- docs/architecture/ARCHITECTURE.md
- cases/*/evaluator/rubric.yaml
- cases/*/evaluator/acceptance.md
- 已合入的契约 Schema

允许修改：
- src/evaluators/core/**
- tests/evaluators/core/**
- docs/architecture/EVALUATOR_PROTOCOL.md
- docs/agent-orchestration/evidence/VAB-T04.md

目标：
实现可组合 Evaluator 生命周期，统一运行命令门禁、结构断言和评分汇总，但不包含具体 Case
业务检查。

必须交付：
1. check 定义、执行上下文、timeout、artifact、status 和 evidence 接口。
2. pass/fail/warning/skipped/error 的明确语义。
3. hard gate、类别权重、cap 和总分计算。
4. 未执行检查不能算通过；P0/hard gate 失败正确封顶。
5. 每个检查保留命令、exit、stdout/stderr 路径、耗时和失败原因。
6. evaluator crash 与被测项目失败分开记录。
7. 支持机器检查和人工检查占位，但不使用 Judge 模型。
8. 单元测试覆盖成功、超时、异常、封顶、缺失 evidence 和重复 check ID。
9. EVALUATOR_PROTOCOL 与 evidence。

禁止修改 bench.mjs 和任何 Case-specific evaluator。验收：
- 本任务测试
- npm test
- git diff --check

如公共 Schema 不足，返回 NEEDS_INTEGRATION_CHANGE，不越界修改。完成后按统一 JSON 回传。
```

