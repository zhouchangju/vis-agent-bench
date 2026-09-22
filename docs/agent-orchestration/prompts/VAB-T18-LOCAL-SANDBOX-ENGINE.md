# VAB-T18：本地轻量隔离与 Fake HOME 沙箱引擎

```prompt
你负责 vis-agent-bench 的 VAB-T18，只实现“本地轻量隔离与 Fake HOME 沙箱引擎”。

仓库：当前工作区
建议分支：codex/vab-t18-local-sandbox

先读取：
- AGENTS.md
- docs/design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md
- docs/architecture/ISOLATION_AND_ANTI_CHEATING.md
- src/runners/adapters.mjs
- src/core/file-isolation.mjs

目标：
在本地执行环境中实现无需 Docker 的极轻量进程隔离保护。包括：
1. 环境变量净化白名单（Stripped Env）；
2. 伪造空 HOME 目录（Fake HOME），彻底切断对宿主机 ~/.claude, ~/.gemini, ~/.codex, ~/.zshrc 的访问；
3. macOS 原生 Seatbelt `sandbox-exec` Profile 自动生成与命令包装器（在 macOS 上可用时拦截对非当前 run 目录的读取）；
4. 增强 CLI 启动参数，确保各大 Agent（Codex, Claude, Kimi, Pi 等）均默认注入 `--ignore-user-config`、`--safe-mode` 等隔离选项。

依赖：
- VAB-T01
- VAB-T02

允许修改：
- src/core/file-isolation.mjs
- src/runners/adapters.mjs
- src/runners/local-sandbox.mjs (新建)
- tests/runners/**
- docs/agent-orchestration/evidence/VAB-T18.md

禁止：
- 严禁引入 Docker 或强制外部沙箱守护进程。
- 保证无 sandbox-exec 环境（如 Linux/CI）优雅降级为环境变量软隔离。

必须交付：
1. 实现 `LocalSandbox` 引擎模块：
   - 自动在 runDir 下创建 `.fake_home` 与 `.tmp`；
   - 过滤 `process.env`，仅保留白名单变量（PATH, LANG, API keys 等）；
   - 提供 macOS `sandbox-exec` 配置模板生成能力。
2. 将 `LocalSandbox` 整合至 `src/runners/adapters.mjs` 中的子进程执行流。
3. 单元测试覆盖环境变量拦截、fake home 建立与沙箱包装逻辑。
4. evidence/VAB-T18.md。

验收：
- npm test
- 运行测试验证注入 fake_home 后 Agent 无法检索到真实宿主机 home 文件。
- git diff --check

完成后以 CONTROL_PROTOCOL 的 JSON 结构回传。
```
