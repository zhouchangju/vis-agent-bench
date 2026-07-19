# 隔离与防答案泄漏

## 目标

参评 Agent 只能看到模型可见需求、脱敏 fixture、干净脚手架和明确允许的工具。它不能读取：

- 真实答案仓库和包含现成实现的提交；
- 隐藏验收、评分权重和参考截图；
- 用户 Home 下的笔记、记忆、规则、聊天记录和其他项目；
- 主机上的 Git 历史、IDE 索引、搜索缓存和全局 MCP；
- 其他模型此前运行的结果。

## 为什么 Prompt 禁止无效

“请不要读取某目录”无法形成可信保证。只要进程拥有读取权限，Agent 就可能通过搜索、绝对路径、Git、IDE 索引、全局规则或插件间接获得答案。

可信保证必须来自进程看不到这些路径，而不是要求模型自律。

## 控制面与工作面分离

```text
Host / Control Plane
├── Case Registry
├── Answer Repositories
├── Hidden Evaluators
├── Fixture Builder
├── Credential Broker
└── Report Generator
          │ only sanitized input
          ▼
Ephemeral Worker
├── /workspace       read-write
├── /task            read-only
├── /run/secrets     minimal credentials, read-only
├── empty HOME
└── CLI executable/runtime
```

Worker 结束后只导出代码差异、日志和允许的产物。隐藏验收在 Worker 销毁后，由 Host 对导出的 workspace 执行。

## 强制措施

### 文件系统

- 不挂载 `/Users/leozhou/git`、Obsidian Vault 或用户 Home；
- 不把答案仓库的父目录挂进容器，即使只读也不允许；
- `/task` 只包含 prompt、fixture 和公开说明；
- `/workspace` 由干净模板创建，不包含答案 Git 历史；
- Hidden Evaluator 不进入 Worker；
- 每次 Run 使用全新目录、全新 HOME 和独立 Git 仓库；
- 禁止通过 Docker socket、宿主机 SSH Agent 或任意主机目录逃逸。

### CLI 个性化

- 禁用用户级规则、记忆、插件、MCP、IDE 和浏览器集成；
- 只加载 Bench 提供的最小系统提示；
- 凭据通过 Secret 引用注入，不写入 prompt、日志和 RunSpec；
- 第三方模型必须记录 provider、endpoint 标识和实际返回模型标识；
- 不复用历史 Session。

### 网络

联网是 Case 权限，不是 Runner 默认假设：

- `network: enabled` 时允许查公开文档和产品页面；
- 内部 Git、制品库、代码搜索、公司 VPN 地址仍需网络层阻断；
- 记录 DNS/目标域名摘要，敏感 Header 不写日志；
- 如果答案代码已经公开，则必须使用答案产生前的历史任务、变体 fixture 或重新设计 Case。

### 审计

每次 Run 生成：

- Worker 镜像/环境指纹；
- 精确 mount manifest；
- 输入文件清单及 SHA-256；
- CLI 版本、参数和净化后的环境变量名；
- stdout/stderr 原始日志；
- 归一化事件日志；
- 初始/最终文件树、Git diff 和产物哈希；
- 隔离预检结果。

## 隔离预检

正式启动模型前必须自动证明：

1. 工作目录是新建的 Run workspace；
2. HOME 为空且不指向真实用户目录；
3. 答案仓库路径在 Worker 中不存在；
4. Hidden Evaluator 路径不存在；
5. 未发现 `.claude`、`.codex`、全局 `AGENTS.md`、`CLAUDE.md` 或未授权 MCP；
6. mount 列表只包含白名单；
7. Worker 无法访问 Docker socket、宿主机 SSH Agent 和内部代码搜索；
8. 输入文件哈希与 Case manifest 一致。

任一项失败，Run 标记为 `invalid-isolation`，不得进入报告排名。

## 防止偶然泄漏

- Fixture 文本去除真实内部路径、提交号、唯一类名和答案文件名；
- 模型可见需求不引用 provenance；
- Case 的 `provenance.md`、`evaluator/` 和候选分析不复制到 Worker；
- 输入模板在复制后执行敏感模式扫描；
- 设置少量不影响任务的 canary 名称，若输出出现则标记人工复核。

## 存量仓库中已经包含答案的 Case

这类 Case 不能把当前仓库或其 `.git` 交给 Agent。

以股权关系叙事可视化为例：

1. Fixture Builder 在 Host 上从固定 commit 导出无 `.git` 快照；
2. 按 answer-exclusion manifest 删除现有股权关系实现、Playground、测试、文档、搜索索引和构建产物；
3. 应用一份只负责移除注册引用的 compile-clean patch；
4. 运行基线 build/lint/test，证明起始工程有效；
5. 扫描 `EquityRelationship`、关键协调器类名、历史提交号和关键实现片段；
6. 将清洗快照复制到 Worker；
7. 答案仓库和完整 Git 历史始终留在 Host。

不建议直接退回功能出现前的旧提交作为唯一方案，因为多年架构和依赖差异会把评测变成旧代码迁移，偏离当前开发效率问题。

## 本地开发模式

可以在本机用 CLI Sandbox 快速调试 Runner，但报告必须显示：

`Isolation: development-only / not leaderboard eligible`

首期采用文件级软隔离：

- `.local/runs/<run-id>/workspace` 为唯一工作目录；
- 起始工程复制时排除 `.git`、依赖、缓存和构建产物；
- Case-specific leakage rules 扫描已知答案文件名和实现特征；
- CLI 禁用或替换自动发现的规则、Skills、浏览器和历史 Session；
- 日志保存精确输入和文件哈希。

由于 CLI 进程仍以当前用户身份运行，这种模式不能声称“保证读不到主机其他目录”。它只表示平台没有主动提供答案，且工作目录中未发现答案。

只有通过容器/VM/专用用户预检的 Run 才显示：

`Isolation: verified`
