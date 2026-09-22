# VAB-T19：场外独立验收与物理隔离评测 Harness

```prompt
你负责 vis-agent-bench 的 VAB-T19，只实现“场外独立验收与物理隔离评测 Harness”。

仓库：当前工作区
建议分支：codex/vab-t19-out-of-band-evaluator

先读取：
- AGENTS.md
- docs/design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md
- docs/architecture/EVALUATOR_PROTOCOL.md
- src/evaluators/core/harness.mjs (或现有 evaluator 入口)
- scripts/bench.mjs

目标：
实现真正的“闭卷考试”评测执行机制：
1. 确保在 Agent 运行阶段，`evaluator/` 目录和任何测试断言文件物理上绝不拷贝到 `runDir/workspace`；
2. 在 Agent 退出后，由场外宿主机控制面调用 `OutOfBandEvaluator`；
3. 以只读方式加载被评测的 workspace 代码，在隔离临时测试宿主中运行 Playwright/DOM/单元测试；
4. 保证被测 Agent 在生命周期内即便遍历本地工作区也无法获知测试用例具体内容。

依赖：
- VAB-T04
- VAB-T08

允许修改：
- src/evaluators/core/**
- scripts/bench.mjs
- tests/evaluators/core/**
- docs/agent-orchestration/evidence/VAB-T19.md

禁止：
- 严禁将验收代码回写或软链接入 Agent 正在编码的工作目录。

必须交付：
1. 实现场外评测调度器 `src/evaluators/core/out-of-band-runner.mjs`：
   - 接受 `runWorkspace` 路径与 `caseEvaluator` 路径；
   - 在独立临时沙箱中挂载/注入被测产物进行判定；
   - 提取测试指标（状态、耗时、截图证据），输出标准 Result Envelope。
2. 单元测试证明在缺少本地测试断言文件的工作区中，场外评测器依然能准确批卷并输出报告。
3. evidence/VAB-T19.md。

验收：
- npm test
- git diff --check

完成后以 CONTROL_PROTOCOL 的 JSON 结构回传。
```
