# VAB-T20：金丝雀探针与越权审计器

```prompt
你负责 vis-agent-bench 的 VAB-T20，只实现“金丝雀探针与越权审计器”。

仓库：当前工作区
建议分支：codex/vab-t20-canary-audit

先读取：
- AGENTS.md
- docs/design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md
- docs/architecture/ISOLATION_AND_ANTI_CHEATING.md
- src/core/file-isolation.mjs
- src/telemetry/**

目标：
构建严密的防作弊与越权探测审计机制：
1. **Canary 探针校验**：在真实参考代码与非公开题干中埋入预设 Canary Token。评测收卷时，深度扫描 Agent 产出的全部代码和修改（Git Diff），若包含未公开的 Canary Token，自动将 Run 标记为 `status: invalid-isolation`，直接取消成绩。
2. **命令越权行为审计**：解析 Agent 运行过程中的 EventLog / Bash 历史，自动检测非法探测命令（如 `cd ../../`、`ls /Users/`、`cat ~/.`、寻找 `case.yaml` 等越权操作），记录安全告警并在评估报告中呈现。

依赖：
- VAB-T02
- VAB-T07

允许修改：
- src/core/canary-detector.mjs (新建)
- src/telemetry/audit.mjs (新建或扩展)
- src/reporting/**
- tests/core/**
- docs/agent-orchestration/evidence/VAB-T20.md

禁止：
- 严禁影响正常文件的合法读取。

必须交付：
1. 实现 `CanaryDetector`：支持基于正则与 Hash 词表的反向扫描，提供报告拦截。
2. 实现 `ExecutionAuditor`：分析 shell 命令与文件访问行为，产生审计评分。
3. 完整的单元测试（包含正常提交通过、命中 Canary 触发作弊警告、越权行为拦截）。
4. evidence/VAB-T20.md。

验收：
- npm test
- git diff --check

完成后以 CONTROL_PROTOCOL 的 JSON 结构回传。
```
