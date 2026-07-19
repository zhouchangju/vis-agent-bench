# VAB-T08：总集成与 Web 控制面

```prompt
你负责 vis-agent-bench 的 VAB-T08，只在所有依赖任务验收后完成总集成与最小 Web 控制面。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t08-integration
依赖：VAB-T01、VAB-T03、VAB-T05、VAB-T06、VAB-T07、VAB-T09、VAB-T10、
VAB-T11、VAB-T12、VAB-T13 全部 accepted。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- 所有依赖任务的 evidence 文件和三个 primary Case 的 Fixture/Evaluator
- docs/architecture/ARCHITECTURE.md
- docs/architecture/RUNNER_PROTOCOL.md
- scripts/bench.mjs
- prototype/setup.html 和 prototype/assets/setup.js

允许修改：
- scripts/bench.mjs
- src/control-plane/**
- tests/e2e/**
- prototype/setup.html
- prototype/assets/setup.js
- package.json
- README.md
- docs/roadmap/ROADMAP.md
- docs/agent-orchestration/evidence/VAB-T08.md

目标：
把已验收模块接入同一条 CLI Core，并让设置页生成同一份 RunSpec；完成一次无收费模型的
端到端 golden run：配置 → fixture → staged runner → evaluator → 真实浏览器证据 →
review 占位 → report。

必须交付：
1. bench CLI 接入 validate/build-fixture/run/evaluate/capture/report 子命令。
2. 每个子命令保持 status/summary/next_actions/artifacts 输出。
3. 设置页可选择 3 个 primary Case、CLI/model、联网、预算和 evidence，并导出 RunSpec。
4. 网页不复制 Runner 逻辑，只生成/读取同一契约。
5. 三个 primary Case 均可由端到端 deterministic fake adapter 跑通，不调用收费模型。
6. 任一步失败后可从已完成 checkpoint 恢复，不重复执行已完成副作用。
7. 最终产出 run-spec、逐阶段日志、evaluation、browser evidence、human-review placeholder
   和 HTML 报告。
8. 更新 README 和 Roadmap，只声明实际通过的能力。

禁止：
- 不重写已验收模块。
- 不放宽 Schema、泄漏扫描或 hard gate 来让 E2E 通过。
- 不加入容器实现；文件隔离继续明确为 development-only。
- 不调用真实模型或真实业务站点。

验收：
- npm test
- golden E2E
- 故意失败后的 checkpoint resume E2E
- npm run bench:doctor
- git diff --check

完成后只提交集成改动，不 push。最终回传必须列出所有依赖 commit、E2E artifact 和仍需
真实模型验证的内容。
```
