# 多 Agent 总控协议

## 1. 角色

- **总控 Agent**：维护任务状态、依赖、上下文、验收和集成，不替执行 Agent 宣称完成。
- **执行 Agent**：只实现一个 Task Prompt，在 allowed paths 内工作并生成 evidence。
- **评审 Agent**：可只读检查 diff、测试和 evidence，不直接扩大功能范围。
- **Benchmark Agent**：未来被测对象，与开发本平台的执行 Agent 不同；不得读取答案仓库和隐藏验收。

## 2. Git 与工作区

1. 首先冻结 baseline commit。
2. 每个任务使用独立 branch 和 worktree。
3. branch 使用任务目录中声明的名称。
4. 执行 Agent 不得修改其他 Agent 的 worktree。
5. 每个任务最多形成一个任务提交；不 push、不创建 PR，除非用户另行要求。
6. 总控按依赖顺序集成；冲突由总控处理，不能让后到 Agent覆盖先到任务。

## 3. allowed paths

- allowed paths 是写权限边界，不是建议范围。
- 可读取完成任务所需的项目文件，但不得修改 allowed paths 之外的文件。
- 发现必须修改越界文件时，停止编码，返回 `NEEDS_INTEGRATION_CHANGE`。
- 公共入口文件尽量只由 `VAB-T00` 或 `VAB-T08` 修改，降低并行冲突。
- 每个任务可以写自己的：
  `docs/agent-orchestration/evidence/<TASK-ID>.md`。

## 4. 任务状态

```text
planned → ready → running → review → accepted
                             ↘ blocked
                             ↘ needs_integration_change
```

只有满足以下条件才可标记 `accepted`：

- diff 位于 allowed paths；
-冻结验收命令成功；
- evidence 文件存在；
- 未运行的验证和未证明的主张已明确写出；
- 无隐藏需求或答案泄漏；
- 总控完成 diff review。

## 5. Evidence 格式

每个任务写入：

```markdown
# <TASK-ID> Evidence

- Status: DONE | PARTIAL | BLOCKED
- Baseline: <commit>
- Branch: <branch>
- Changed paths:
- Acceptance commands and results:
- Produced artifacts:
- Not proven:
- Remaining risks:
- Integration notes:
- Rollback:
```

Agent 最终回复同时使用：

```json
{
  "status": "success | warning | error",
  "summary": "one-line outcome",
  "next_actions": [],
  "artifacts": [],
  "tests": [],
  "changed_paths": [],
  "not_proven": [],
  "integration_notes": []
}
```

## 6. 错误恢复

执行失败时必须返回：

- root cause；
- 已尝试的修复；
- 安全重试方式；
- 是否需要用户或总控决策；
- 当前 diff 是否可保留；
- 明确 stop condition。

总控优先在同一个 Agent 会话中发送窄化后的恢复 Prompt，避免新 Agent 重复探索。

## 7. 上下文控制

- Prompt 只放稳定约束和任务目标，大文档通过路径引用。
- Agent 开始时只读 `AGENTS.md`、本 Task Prompt、直接依赖契约和目标代码。
- 不把所有 Case 的完整需求同时投喂。
- 每个 Wave 结束后，总控生成一次集成摘要，再开始下一 Wave。

## 8. 安全边界

- 不提交凭据、Cookie、内部 URL、真实业务方敏感数据或未脱敏素材。
- Fixture Builder 可以在明确授权的任务中只读来源仓库，但不得复制答案实现。
- 模型可见 fixture、Prompt 和 workspace 不得包含 `provenance.md`、隐藏 evaluator 或来源仓库历史。
- 文件级隔离仍是开发模式，不可声称提供 OS 级防读取能力。

