# VAB-T02：Fixture Builder 与隔离框架

```prompt
你负责 vis-agent-bench 的 VAB-T02，只实现通用 Fixture Builder 和文件隔离框架。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t02-fixture-framework
依赖：VAB-T00 已合入。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- docs/architecture/ISOLATION_AND_ANTI_CHEATING.md
- src/core/file-isolation.mjs
- 三个 primary Case 的 fixture/README.md 和 provenance.md

目标：
提供确定性的 fixture 构建生命周期：
source/scaffold → exclusion → compile-clean patch → leakage scan → baseline gates → manifest → export。

允许修改：
- src/fixtures/**
- src/core/file-isolation.mjs
- scripts/build-fixture.mjs
- tests/fixtures/**
- docs/architecture/ISOLATION_AND_ANTI_CHEATING.md
- docs/agent-orchestration/evidence/VAB-T02.md

禁止：
- 不实现任何具体 Case fixture。
- 不复制来源仓库代码。
- 不删除或修改来源仓库。
- 不声称文件隔离等于 OS 安全隔离。

必须交付：
1. Fixture manifest 与构建步骤接口。
2. 排除 .git、依赖、缓存、答案实现、文档、测试和索引的规则。
3. path/content/canary 泄漏扫描，结果含规则、位置和恢复建议。
4. 可重复构建：相同输入产生相同 manifest/hash；临时目录安全清理。
5. baseline gate hook，可运行 build/typecheck/test，但由 Case 声明命令。
6. 失败时不发布半成品 fixture。
7. 正反 fixture 测试和 evidence。

验收：
- 本任务测试
- npm test
- 使用最小临时样例证明正常导出、答案泄漏拒绝和构建失败拒绝
- git diff --check

入口接线留给 VAB-T08。完成后只提交本任务文件，不 push，按统一 JSON 回传。
```

