# 总体架构

## 1. 核心对象

```text
ModelProfile
  └── RunnerAdapter
        └── Run
              ├── Case
              ├── Workspace
              ├── EventLog
              ├── Artifacts
              └── EvaluationResult
```

### ModelProfile

描述实际被测试的运行组合，而不只是模型名：

- 模型与版本；
- API / CLI / desktop / browser / manual；
- 文件、终端、浏览器和联网能力；
- Token 与费用采集方式；
- 默认超时与重试规则。

### RunnerAdapter

将不同运行方式收敛为统一生命周期：

```text
prepare → start_session → send_stage → checkpoint → resume_session → collect
```

客户端没有自动化接口时，允许使用半自动 Adapter：

- 平台生成独立 Run ID、工作区和启动 Prompt；
- 用户在客户端打开对应工作区；
- 平台监听文件变化和进程结果；
- 用户确认 Agent 已结束；
- 后续验收和报告仍自动完成。

### Case

由五部分组成：

1. 初始模糊业务 Brief；
2. 分阶段 stakeholder / review packets；
3. Fixture 与附件；
4. 内部完整需求真相与验收契约；
5. 预算、权限和停止条件。

Case 按照六大任务类型（`feature-dev`, `bug-hunting`, `perf-tuning`, `reconstruction`, `greenfield-3d`, `refactor-migrate`）与四大难度等级（`bronze`, `silver`, `gold`, `diamond`）进行结构化治理。详见 [任务分类分级规范](../design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md)。

### Evaluator

按确定性从高到低分层：

1. build/lint/type/test；
2. DOM、Canvas、WebGL 和交互断言；
3. 截图、性能、内存和资源释放；
4. 业务语义规则；
5. Judge 模型；
6. 人工盲审。

## 2. 运行隔离

正式运行既要防止修改源仓库，也要防止读取答案仓库。针对本地执行与无 Docker 场景，平台提供基于本地文件系统的轻量级隔离与防作弊能力。

可信边界分层：

1. **容器 / 专用微虚机**：最强隔离，只挂载 Run 工作区；
2. **本地文件系统轻量隔离（推荐）**：
   - 独立瞬态工作区（全新 git init，无 remote，无历史 commit）；
   - 伪造空 HOME（`HOME=.fake_home`）与环境变量白名单净化，阻断主机配置与记忆泄露；
   - 场外裁判（Out-of-band Evaluator）：断言与参考答案物理上绝不进入被测工作区，交卷后在场外离线执行评分；
   - macOS 原生内核沙箱（`sandbox-exec` / Apple Seatbelt）：在系统层阻断跨目录文件探测；
   - 全程 Canary 探针与越权命令审计；
3. **专用低权限系统用户**：使用文件 ACL 阻止读取其他仓库；
4. **仅用于开发调试的本机宽松模式**：软隔离，不产生正式榜单结果。

每个 Run 必须有唯一目录：

```text
runs/<run-id>/
├── input/
├── workspace/
├── .fake_home/
├── logs/stages/<stage-id>/
├── artifacts/
└── result.json
```

详细规则见 [隔离与防答案泄漏](ISOLATION_AND_ANTI_CHEATING.md) 与 [任务分类分级与本地轻量隔离规范](../design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md)。

## 3. 观测输出契约

Runner 和 Evaluator 的所有阶段应输出：

```json
{
  "status": "success | warning | error",
  "summary": "one-line result",
  "next_actions": [],
  "artifacts": []
}
```

错误还必须包含：

- root cause hint；
- safe retry；
- stop condition。

## 4. 当前实现顺序

先完成 Case 与 CLI 核心，再做网页控制台。网页不能成为另一套执行逻辑。

设置页生成同一份 RunSpec 配置，后端 CLI 与网页都调用同一个 Runner Core。
