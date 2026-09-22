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

通用 Fixture Builder 生命周期（参见 `src/fixtures/builder.mjs`）：

1. **Scaffold**：Fixtu 构建器从指定源拷贝全树；
2. **Exclusion**：应用默认排除规则（`.git`、`node_modules`、构建产物、编辑器缓存、搜索索引等），按需叠加 Case 声明的 `fixture/plan.yaml` 排除项；
3. **Compile-clean patch**：应用仅移除注册引用、恢复可编译状态的补丁，不包含布局或交互答案；
4. **Leakage scan**：三层扫描（path/content/canary），记录 rule_id、位置、发现片段和修复建议；路径和内容发现会阻断发布，canary 发现仅作建议；
5. **Baseline gate**：运行 Case 声明的 `build`、`typecheck`、`test`、`lint` 步骤；任一必选步骤失败则拒绝发布；
6. **Manifest**：生成确定性清单，含文件哈希、泄漏规则摘要、构建环境指纹和可复现摘要；
7. **Publish**：仅在全部门槛通过后原子发布至导出根目录。

以股权关系叙事可视化为例：

不建议直接退回功能出现前的旧提交作为唯一方案，因为多年架构和依赖差异会把评测变成旧代码迁移，偏离当前开发效率问题。

## 本地轻量隔离模式（Local Lightweight Sandboxing）

为避免 Docker 在本地开发环境下的重量级负担（启动开销大、文件系统跨层性能损耗、无头浏览器与 GPU 渲染配置繁琐），平台提供一套零依赖、极轻量的本地文件系统隔离防作弊体系：

1. **瞬态独立工作区（Detached Workspace）**：
   - 每次 Run 在 `.local/runs/<run-id>/workspace` 动态生成；
   - 仅包含脱敏后的起始代码与当前轮 Prompt；
   - 初始化独立空 Git 仓库（无 remote，无提交图谱历史），与宿主机源码库物理脱钩。
2. **伪造空 HOME 与环境变量净化（Fake HOME & Stripped Env）**：
   - 启动 Agent 子进程时，强行重定向 `HOME=.local/runs/<run-id>/.fake_home` 与 `TMPDIR=.local/runs/<run-id>/.tmp`；
   - 严格净化环境变量，仅保留必须的 `PATH` 与 API Key，抹除一切宿主机 shell 变量与用户个性化记忆；
   - 阻止 Agent 自动读取宿主机的 `~/.zshrc`、`~/.bash_history`、`~/.claude/`、`~/.gemini/`、`~/.codex/` 等全局配置。
3. **场外裁判物理隔离（Out-of-band Evaluator）**：
   - 测试断言、参考答案、评分标准**物理上绝不进入工作区**；
   - 模拟闭卷考试：Agent 在工作区内搜遍全盘也无法找到评分脚本；
   - Agent 交付退出后，宿主机评测器才在场外安全挂载被测产物进行离线判定。
4. **macOS 原生内核沙箱（Apple Seatbelt / `sandbox-exec`）**：
   - 在 macOS 系统下，自动生成最小安全规则 profile；
   - 允许读取系统底层库与当前 Run 临时工作区；
   - 显式内核级拦截对宿主机真实工程目录（如 `/Users/.../git/`）与敏感目录（如 `~/.ssh`）的任何读取尝试，返回 `Permission denied`。
5. **Canary 探针与越权审计（Canary Tokens & Command Audit）**：
   - 在未公开资料中埋设特殊 Canary Token。若 Agent 产物中命中 Token，判定越权偷看，标记 `status: invalid-isolation` 并成绩作废；
   - 实时审计 EventLog 中的 shell 命令，发现 `cd ../../` 或探测主机的行为即时告警。

满足上述本地防作弊沙箱预检（Fake HOME + 场外验收 + 探针扫描 + sandbox-exec）的本地运行可标记为：

`Isolation: local-sandbox-verified`

