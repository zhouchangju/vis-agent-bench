# VAB-T01：CLI Adapter 协议与遥测

```prompt
你负责 vis-agent-bench 的 VAB-T01，只实现 CLI Adapter 契约和可审计遥测。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t01-runner-telemetry
依赖：VAB-T00 已合入当前 baseline。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- docs/architecture/RUNNER_PROTOCOL.md
- src/runners/adapters.mjs
- src/core/process-runner.mjs
- schemas 中已合入的 RunSpec/Result 契约

目标：
让 Codex、Kimi Code、Claude Code 的命令构建、版本探测、Session 连续性和输出解析可测试，
并统一记录 wall time、exit、timeout、重试、阶段、可获得的 token/cost 数据及其来源。

允许修改：
- src/runners/**
- src/telemetry/**
- tests/runners/**
- docs/architecture/RUNNER_PROTOCOL.md
- docs/agent-orchestration/evidence/VAB-T01.md

禁止：
- 不修改 scripts/bench.mjs，由集成任务接线。
- 不真实调用收费模型。
- 不根据输出文本猜 token 或费用；拿不到时必须记录 unavailable + reason。
- 不记录或回显凭据。

必须交付：
1. 三种 Adapter 的统一接口与命令快照测试。
2. JSONL/普通输出的归一化事件解析。
3. token/cost provenance：native_cli、provider_api、estimated、unavailable；首期 estimated 默认禁用。
4. 进程时间、自然时间、阶段时间、退出与超时的确定性记录。
5. 对截断 JSONL、未知事件、空输出和非零退出的恢复行为。
6. docs 协议更新和 evidence。

使用 fixture 日志测试，不依赖真实账号。验收：
- 本任务测试
- npm test
- git diff --check

若需要修改 bench.mjs 或 package.json，返回 NEEDS_INTEGRATION_CHANGE 并说明接线点，不要越界。
完成后只提交本任务文件，不 push，按 CONTROL_PROTOCOL JSON 回传。
```

