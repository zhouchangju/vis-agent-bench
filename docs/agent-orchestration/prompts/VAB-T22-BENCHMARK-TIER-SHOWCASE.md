# VAB-T22：首批分级典型案例库补齐（Bug 排查与性能调优）

```prompt
你负责 vis-agent-bench 的 VAB-T22，只实现“首批分级典型案例库补齐”。

仓库：当前工作区
建议分支：codex/vab-t22-tier-showcase

先读取：
- AGENTS.md
- docs/design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md
- docs/agent-orchestration/task-catalog.yaml 中 VAB-T22
- cases/standard-chart-two-way-tree/
- cases/ainvest-market-heatmap-rebuild/

目标：
当前案例池缺少标准 `bug-hunting`（缺陷排查）与 `perf-tuning`（性能调优）的正式案例。本任务基于真实可视化痛点补齐 2 个标准 Case：
1. `cases/chart-resize-race-bugfix`（银牌级 `bug-hunting`）：
   - 典型场景：图表在窗口高速 Resize 或快速切换 Tab 时出现 Canvas 绘制重叠、文字截断与 Tooltip 残留。
   - 目标：要求 Agent 定位到防抖失效与未清理画布的竞态根因，在保持 API 不变的前提下给出最小化修复。
2. `cases/canvas-memory-leak-tuning`（金牌级 `perf-tuning`）：
   - 典型场景：万级节点动态增删时，动画循环（requestAnimationFrame）未注销且闭包引用大量 Detached DOM 导致内存飙升。
   - 目标：要求 Agent 分析内存占用根因，实现对象池复用与组件卸载销毁清理，通过自动化内存阈值断言。

依赖：
- VAB-T17
- VAB-T21

允许修改：
- cases/chart-resize-race-bugfix/** (新建)
- cases/canvas-memory-leak-tuning/** (新建)
- tests/cases/**
- docs/agent-orchestration/evidence/VAB-T22.md

禁止：
- 严禁在 starter fixture 中泄露带有答案提示的代码注释。

必须交付：
1. 完整构造两个新 Case 的标准全量结构（case.yaml, scenario, prompt, evaluator, fixture, provenance.md）。
2. 提供真实对应的确定性验收用例（包括失败样本与通过样本）。
3. 扩展现有 `npm test` 自动覆盖新增 Case 的结构与验收。
4. evidence/VAB-T22.md。

验收：
- npm test
- node scripts/validate-structure.mjs
- git diff --check

完成后以 CONTROL_PROTOCOL 的 JSON 结构回传。
```
