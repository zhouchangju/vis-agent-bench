# Run 日志与证据规范

## 归一化事件

每行一个 JSON 对象：

```json
{
  "ts": "2026-07-19T12:00:00.000Z",
  "run_id": "run_...",
  "seq": 12,
  "source": "codex",
  "type": "tool.end",
  "phase": "implementation",
  "status": "success",
  "summary": "Tests completed",
  "duration_ms": 18342,
  "usage": {
    "input_tokens": 1200,
    "output_tokens": 430,
    "cached_tokens": 0,
    "cost_usd": null,
    "availability": "partial"
  },
  "artifacts": ["logs/test-output.txt"],
  "raw_ref": "stdout.raw#L128"
}
```

## 事件类型

- `run.created`
- `isolation.preflight`
- `stage.started`
- `stage.context.sent`
- `requirement.ledger.updated`
- `stage.checkpoint`
- `process.started`
- `assistant.message`
- `tool.started`
- `tool.ended`
- `file.changed`
- `clarification.requested`
- `clarification.answered`
- `permission.requested`
- `permission.allowed`
- `permission.denied`
- `stage.blocked`
- `budget.warning`
- `process.ended`
- `evaluator.started`
- `evaluator.ended`
- `human.review`
- `human.intervention`
- `stage.ended`
- `run.completed`

## 时间口径

- `agent_wall_time`：CLI 进程自然时间；
- `human_touch_time`：准备、答疑、Review、修复和验收；
- `time_to_shared_understanding`：到 P0 范围确认的时间；
- `time_to_first_reviewable_poc`：到业务方可实际走查首版的时间；
- `end_to_end_time`：从 Run 创建到达到最终状态；
- `idle_wait_time`：排队、限流、等待用户但不占人工的时间。

这些时间不得互相替代。

人工事件必须带 `category`，取值为：

`clarification / context_prep / poc_review / micro_adjustment / fix / final_review`

同时记录 `duration_minutes` 和输入摘要。自动等待不得算入人工时间。

## Token 与费用

- CLI 提供 usage 时按事件累加并保存原始证据；
- 只有 provider 明确返回费用时才记录精确费用；
- 已知 Token、未知单价时记录 Token 并把 cost 标为 `unavailable`；
- 客户端不提供 usage 时不得根据文字长度伪造 Token；
- 报告明确显示 `reported / calculated / unavailable`。

## 文件证据

- 初始和最终文件树；
- 新增、修改、删除及二进制文件列表；
- Git diff 和最终 commit hash（若有）；
- Build、Lint、Typecheck、Test 原始输出；
- 浏览器截图、视频、性能 trace；
- Evaluator 机器、浏览器和依赖版本；
- 人工修改必须与 Agent 修改分开提交或分开 patch。

## 日志真实性

Agent 自己写的“我完成了”只能算陈述，不能算验收证据。报告只使用：

- Runner 观测；
- Git/文件系统事实；
- Evaluator 输出；
- 人工 Review 记录。

## 无人值守可回放要求

每个阶段必须独立保留：

- 实际发送的 Prompt 与附件摘要；
- CLI 版本、权限模式和脱敏后的命令；
- 原始 stdout/stderr 与归一化事件；
- 阶段前后文件清单和变化摘要；
- checkpoint 期望、实际路径和校验状态；
- 澄清请求、自动答复来源和答复轮数；
- 权限请求、允许/拒绝结果及命中的策略；
- 根因提示、安全重试建议和明确停止条件。

Agent 维护的 `requirement-ledger.yaml` 必须按阶段快照保存。报告可以分析约束保持率，但不能
把 Ledger 中的 `implemented` 直接视为实现事实。
