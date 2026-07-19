# CLI Runner 统一协议

## 原则

Codex、Kimi Code、Claude Code 都通过命令行非交互模式调用。网页不直接调用进程，而是：

```text
Setup UI → RunSpec → Runner Service → Adapter → CLI Process
                                      ↓
                              Event Normalizer
                                      ↓
                         logs / artifacts / result
```

每个 Adapter 实现同一生命周期：

```text
detect → prepare → preflight → start_session
  → send_stage → stream → checkpoint
  → resume_session → send_stage ... → stop → collect → normalize
```

## RunSpec

RunSpec 至少包含：

- Case ID 和输入版本；
- engine、CLI 版本、provider、模型标识；
- executable 及 Adapter 类型；
- 隔离模式、联网、超时、重试；
- Token/费用/自然时间预算；
- 允许工具和输入附件；
- Secret 引用；
- 输出目录和停止条件。

网页设置页与 YAML 配置是同一对象的两种编辑方式。网页保存 YAML/JSON，CLI 可直接运行该文件。

## 多阶段会话

主 Case 默认不是 one-shot。Runner 读取 `scenario/stages.yaml`，每个阶段：

1. 发送本阶段输入和允许读取的附件；
2. 等待 Agent 产出约定 checkpoint；
3. 运行阶段检查并保存代码、截图和 Requirement Ledger；
4. 记录人工输入和耗时；
5. 在同一会话恢复并发送下一阶段反馈。

若某 CLI 无法可靠恢复会话，Adapter 可用“阶段摘要 + workspace 状态”启动新会话，但必须
记录 `session_continuity=synthetic`，不能与原生连续会话混为一谈。

标准阶段事件至少包含：

```json
{
  "stage_id": "S2",
  "event_type": "stakeholder_feedback",
  "input_files": ["scenario/packets/S2-poc-feedback.md"],
  "human_minutes": 0,
  "context_bytes": 4821,
  "requirement_ledger_sha256": "...",
  "checkpoint_status": "success"
}
```

## Codex Adapter

本机已探测：

- executable：`codex`
- version：`codex-cli 0.144.6`
- 非交互入口：`codex exec`
- 事件输出：`--json` JSONL
- 最终消息：`--output-last-message`
- 模型：`--model`
- 工作目录：`--cd`
- CLI 内层权限：`--sandbox workspace-write --ask-for-approval never`
- 净化：`--ephemeral --ignore-user-config --ignore-rules`

概念命令：

```bash
codex exec \
  --cd /workspace \
  --model "$MODEL_ID" \
  --sandbox workspace-write \
  --ask-for-approval never \
  --ephemeral \
  --ignore-user-config \
  --ignore-rules \
  --json \
  --output-last-message /output/final.md \
  - < /task/prompt.md
```

CLI Sandbox 是 Worker 内的第二层限制，不能替代外层容器。

## Claude Code Adapter

本机已探测：

- executable：`claude`
- version：`2.1.177`
- 非交互入口：`claude --print`
- 流式事件：`--output-format stream-json`
- Hook 事件：`--include-hook-events`
- 模型：`--model`
- 费用上限：`--max-budget-usd`
- 结构化最终输出：`--json-schema`
- 净化：`--bare --no-session-persistence --strict-mcp-config --no-chrome`

概念命令：

```bash
claude --print \
  --bare \
  --no-session-persistence \
  --strict-mcp-config \
  --no-chrome \
  --model "$MODEL_ID" \
  --permission-mode dontAsk \
  --output-format stream-json \
  --include-hook-events \
  --max-budget-usd "$MAX_BUDGET_USD" \
  < /task/prompt.md
```

使用 Claude Code 测 GLM、DeepSeek 等第三方模型时，Adapter 还必须记录：

- provider 类型；
- endpoint 的脱敏标识；
-配置模型名；
- 首个响应中可获得的实际模型名；
- 使用量和费用由谁提供。

只改 `--model` 而没有验证实际 provider，不得把结果归因到目标模型。

## Kimi Code Adapter

当前机器已确认：

- executable：`/Users/leozhou/.kimi-code/bin/kimi`
- version：`0.27.0`
- 非交互入口：`--prompt`
- 流式事件：`--output-format stream-json`
- 模型：`--model`
- 自动权限：`--auto`
- Skills 隔离：`--skills-dir`

概念命令：

```bash
/Users/leozhou/.kimi-code/bin/kimi \
  --auto \
  --model "$MODEL_ID" \
  --prompt "$PROMPT" \
  --output-format stream-json \
  --skills-dir /run/empty-skills
```

Kimi 使用工作目录作为主 workspace，不复用历史 Session。Token/费用只在 stream-json 实际提供时记录，否则标记 `unavailable`。

## 首期文件级软隔离

为了先跑通流程，MVP 允许：

- 每个 Run 使用全新目录和新 Git 仓库；
- 只复制模型可见输入和清洗后的起始工程；
- 删除 `.git`、构建产物、缓存和已知答案；
- 启动前执行答案泄漏扫描；
- 通过 CLI 参数禁用规则、Skills、浏览器和历史 Session；
- 使用当前用户认证配置启动 CLI。

该模式不能从操作系统层面阻止进程读取主机其他目录，必须标记：

`file-isolated-development / leaderboard_eligible=false`

它适合首期验证 Runner、Case 和报告流程，不适合作为最终可信排行榜依据。

## 日志与输出

Adapter 不能只保存最终回答。每次 Run 至少产生：

```text
logs/
├── command.json
├── environment.json
├── stdout.raw
├── stderr.raw
├── events.jsonl
├── normalized-events.jsonl
├── files-before.json
├── files-after.json
└── git.diff
artifacts/
├── final-message.md
├── screenshots/
├── test-results/
└── agent-summary.json
result.json
```

`command.json` 和 `environment.json` 必须脱敏，永远不记录 Secret 值。

## 停止条件

- CLI 正常退出；
- 超过自然时间、Token 或费用预算；
- 连续无输出且无文件变化；
- workspace 超过空间上限；
- 隔离违规；
- 进程生成失控子进程；
- 人工终止。

终止后仍需 collect，保留失败证据。
