# VAB-T21：真实题目采集转换流水线与脚手架工具

```prompt
你负责 vis-agent-bench 的 VAB-T21，只实现“真实题目采集转换流水线与脚手架工具”。

仓库：当前工作区
建议分支：codex/vab-t21-case-intake

先读取：
- AGENTS.md
- docs/design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md
- cases/dev-workflow-smoke/
- cases/standard-chart-two-way-tree/
- scripts/build-fixture.mjs

目标：
开发一个题目采集辅助命令行工具 `scripts/intake-case.mjs`，使团队能将日常 Git PR、Jira Bug、Figma 设计稿一键初始化为符合规范的标准 Benchmark Case 脚手架。

依赖：
- VAB-T17

允许修改：
- scripts/intake-case.mjs (新建)
- templates/case/** (新建标准化 Case 模板)
- tests/scripts/intake-case.test.mjs (新建)
- docs/agent-orchestration/evidence/VAB-T21.md

禁止：
- 不修改现有 cases 真实内容。

必须交付：
1. 实现 `scripts/intake-case.mjs` CLI，支持参数化创建新 Case：
   - `--id <case-id>`
   - `--type <task-type>` (feature-dev | bug-hunting | perf-tuning | reconstruction | greenfield-3d | refactor-migrate)
   - `--difficulty <difficulty>` (bronze | silver | gold | diamond)
   - `--title <title>`
2. 自动生成规范目录结构：
   - `case.yaml`（自动填入新分类与分级字段）
   - `scenario/initial-brief.md`（包含模糊业务 Brief 模板）
   - `scenario/stages.yaml`（标准多轮阶段定义）
   - `prompt/requirement.md`
   - `prompt/clarifications.yaml`
   - `evaluator/acceptance.md` 与 `evaluator/rubric.yaml`
   - `fixture/`
   - `provenance.md`（血统追溯）
3. 单元测试证明生成的 Case 可以 100% 通过 `scripts/validate-structure.mjs`。
4. evidence/VAB-T21.md。

验收：
- npm test
- node scripts/intake-case.mjs --id demo-intake-test --type bug-hunting --difficulty silver --title "Demo Test"
- node scripts/validate-structure.mjs
- git diff --check

完成后以 CONTROL_PROTOCOL 的 JSON 结构回传。
```
