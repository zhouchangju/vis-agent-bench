# vis-agent-bench 首轮开发与真实模型运行复盘

> 时间范围：2026-07-19 ～ 2026-07-20
>
> 复盘对象：需求建模、Case 设计、多 Agent 并行开发、CLI Adapter、真实模型运行、断点恢复、视觉反馈 Revision、证据与报告
>
> 一句话结论：`neutral`——方向和最终架构基本正确，但真实模型纵切介入偏晚，导致 24 个功能提交之后又出现 24 个修复提交；平台已从“能调用模型”进化到“能保留证据并恢复长任务”，下一阶段必须转向人效数据和业务验收闭环。

## 1. 结论先行

这轮最重要的成果不是跑出了某个模型的分数，而是把一个最初模糊的“测一下 Kimi K3 的 3D 和可视化能力”任务，逐步收敛成了可复用的评测 Harness：

- 用真实业务瓶颈构建 Case，而不是用容易生成漂亮 Demo 的简单题；
- 支持 Codex、Claude Code、Kimi Code、Pi 四类 CLI；
- 支持渐进式需求披露、Requirement Ledger、独立工作区、日志、checkpoint、报告和断点恢复；
- 区分 CLI 完成、确定性 Evaluator、人工视觉验收和排行榜资格；
- 首轮产物视觉不理想时，可以基于父 Run 创建带图片和反馈的 Revision 子 Run，复用已有代码；
- 两个 Kimi Revision 子 Run 最终都完成 R0～R2，进入 `awaiting-evaluation`。

但这轮也证明：**一个评测平台真正困难的部分，不是把 Prompt 交给 CLI，而是控制长时间、异构、可能中断、证据不完整且仍需人工判断的开发过程。**

当前平台已经较好回答：

> 模型是否完成了阶段任务？生成了什么？在哪里失败？能否继续？

但还不能稳定回答领导最关心的：

> 相比团队当前“工程师 + Codex + 主力 GPT”工作流，模型到底减少了多少需求澄清、测试、微调和返工时间？

根因是 Human Touch Time、人工基线、缺陷修改轮次和最终业务验收尚未形成稳定采集闭环。下一阶段不应继续优先扩 Case 或 Adapter，而应先补齐这条数据链。

## 2. 复盘证据与边界

本复盘使用以下证据：

- Git：从 baseline 到当前分支共 66 个提交，其中 `feat=24`、`fix=24`、`docs=7`、`chore=9`、`test=1`、其他 1；
- 任务契约与验收：`docs/agent-orchestration/` 下 VAB-T00～T16；
- 真实模型 Pilot：`docs/reports/pilots/2026-07-19-real-model-pilot.md`；
- 本地真实 Run：16 个有 `run-state.json` 的 Run 快照；
- 故障证据：各 Run 的 `run-state.json`、阶段 stdout/stderr、checkpoint gate 和 provider diagnosis；
- 两个 Revision 子 Run：
  - Macro Map 3D：`2026-07-20T06-42-46-985Z_revision_kimi_1d3ecf92`；
  - 股权关系叙事可视化：`2026-07-20T07-02-19-405Z_revision_kimi_6c32c0ad`。

限制：

- 本地 Run 状态包含旧 Harness 运行、失败样本和未执行最终 evaluate 的 Run，不能直接当模型成功率；
- 不同 Run 的 Harness commit、模型额度、Provider、Token/费用完整性并不一致，不能横向排名；
- AI Coding 会话预检没有取得可用的结构化会话摘要，因此本文不伪造 Prompt 级分数；
- 本文只总结项目和工程方法，不复制完整私有对话、内部业务数据或密钥。

## 3. 过程回放

### 3.1 从“测模型”转向“测真实交付”

最初容易走向三个误区：

1. 只测 3D 生成、前端页面和视觉设计 Demo；
2. 一次性给完整 Spec，比较谁更快写完；
3. 把生成成功或 build 通过当成“大幅提效”。

经过多轮追问，目标被重新定义为：

- 测试真实可视化工作，而不是模型宣传页上的典型能力；
- 测试需求澄清、POC、反馈、微调和验收的完整收敛过程；
- 主基线是团队当前 AI 辅助开发方式，不是纯人工手写；
- 只有达到业务质量门槛，才计算有效提效。

这是本轮最关键、最正确的产品决策。

### 3.2 Case 从“多而简单”收敛为“少而有区分度”

首期 Case 经历了明显收敛：

- StandardChart TODO 暂缓；
- 产业链双向树由主 Case 降为备选；
- 股权关系叙事可视化升级为主 Case；
- Macro Map 3D 从真实项目提取复杂布局、交互、性能和工程约束；
- AInvest Heatmap 采用真实上线业务的复刻任务。

这说明 Case 的准入标准应该是：

> 它是否覆盖团队真实的人力瓶颈，并能够区分“快速 Demo”和“可验收交付”，而不是它是否方便编写 Prompt。

### 3.3 多 Agent 并行开发快速搭起平台骨架

VAB-T00～T16 将工作拆成契约、Runner、Fixture、Evaluator、浏览器证据、报告和集成等独立任务。该方式的优点很明确：

- 独立模块并行推进快；
- 每个任务有写路径、输入、验收和证据；
- 基础能力很快形成完整骨架；
- 确定性测试和安全加固能够独立演进。

但并行开发也留下了集成债：

- 各模块对 checkpoint、Run 状态和 artifact 的语义理解并不完全一致；
- Adapter 在“会话恢复、费用、输出格式、权限”上的差异直到真实运行才显现；
- 单模块测试通过，不等于跨 CLI 长流程可用。

### 3.4 真实模型运行暴露控制面问题

真实 Pilot 连续暴露出以下问题：

- Codex reasoning effort、写权限、Session resume 和费用上限确认；
- Kimi 非交互执行、状态解析、额度耗尽和恢复；
- Claude Code 的单阶段费用上限、GLM 五小时额度和 429；
- Pi 模型/Provider 映射、输出无限增长和 Node 字符串上限；
- Run 已产出代码，但 checkpoint 或报告仍显示 warning；
- 用户跑完后不知道到哪里看网页、报告和关键证据；
- Token、缓存 Token、费用字段并非所有 CLI 都提供，不能用 `0` 冒充真实零费用。

这些不是零散 Bug。它们共同说明：**Adapter 协议只统一命令形式是不够的，还必须统一能力声明、恢复语义、遥测完整性和故障分类。**

### 3.5 视觉反馈推动 Revision 成为一等流程

股权关系和 3D 的首轮产物都证明：

- 纯文字可以推动功能实现；
- 但布局层级、视觉重心、连线密度、叙事节奏和细节风格难以只靠文字收敛；
- 把所有视觉上下文一次塞进初始 Prompt，又会增加注意力稀释和 Token 成本。

因此新增 Revision 子 Run：

- 父 Run 和已有代码保持不变；
- 子 Run 复制父 workspace；
- R0 先读取图片并形成 visual grounding；
- R1 做窄范围修订；
- R2 做回归和前后证据；
- 保留父子血缘、图片哈希和新会话。

这不是临时补丁，而是对真实可视化研发过程的更准确建模。

## 4. 主要问题、根因与已形成的改进

| 编号 | 问题 | 表层现象 | 根因 | 已形成的改进 |
| --- | --- | --- | --- | --- |
| P01 | 初始测试题偏多、部分难度不足 | 简单组件很可能所有模型都能完成 | 先从“能力清单”出发，没有先找团队真实时间瓶颈 | 建立瓶颈型 Case 准入；股权关系替代双向树成为主 Case |
| P02 | 真实模型纵切介入偏晚 | 骨架完成后连续出现大量集成修复 | 先并行建设完整模块，再验证跨 CLI 最小链路 | 已有 L0/L1/L2 分层；后续要求每个 Adapter 先过最小真实纵切 |
| P03 | 把不同 CLI 当作同构执行器 | cost cap、reasoning、Provider、权限和 Session 行为不一致 | Adapter 只抽象了命令，没有先声明能力矩阵 | Runner 已分 Adapter；下一步增加机器可读 capability/preflight |
| P04 | checkpoint 的“逻辑名”和“文件路径”混淆 | 已有交付物却被判门禁失败；`docs/limitations.md` 与根目录文件不匹配 | artifact contract 类型不够明确，Prompt 也不够精确 | checkpoint manifest、失败反馈、根目录路径约束已加固 |
| P05 | 恢复最初被当作异常功能 | 额度恢复后重跑仍可能重复阶段、耗费 Token 或消耗重试次数 | 长任务和配额中断是常态，但状态机按一次性 Run 设计 | 支持 `--resume-run`、保留 workspace/Session、重置活动时间窗、额度暂停不占重试 |
| P06 | 输出未做有界采集 | Pi 输出增长到 Node 无法创建超长字符串 | 进程采集按一次性读入设计，未按长时流处理 | Pi 精简输出、日志有界读取与稳定长 Run |
| P07 | 状态层级混淆 | `success`、`warning`、`awaiting-evaluation` 容易被理解成同一件事 | CLI、checkpoint、Evaluator、人工验收和排行榜资格未被清晰分层 | 报告已区分流程门禁与业务验收；仍需统一状态机和 UI |
| P08 | 初始上下文缺少视觉参照 | 功能可运行，但布局、层级和叙事表达不理想 | 纯文字难表达视觉事实；完整上下文一次投喂会稀释注意力 | 增加带图片的 Revision 子 Run 和 visual grounding |
| P09 | 基线保护范围不完整 | Revision 修改了既有 smoke 脚本，引发门禁失败 | Prompt 只禁止改 build/typecheck/test，实际 package gate 保护所有既有脚本 | 已扩大 Revision 基线保护并明确新增测试使用 `revision-` 前缀 |
| P10 | 运行结果入口不友好 | 跑完后还要人工查找报告和网页 | CLI 只面向机器返回 artifacts，没有面向操作者设计 handoff | 增加 quick-view 路径、HTML、最终网页和 Ledger 直接入口 |
| P11 | Token/费用数据不完整 | 有的 Run 显示 0，有的只报告部分 usage | CLI/Provider 的遥测能力不同；0、null、unavailable 语义曾混淆 | 增加 provenance 和 completeness；禁止把缺失数据解释成零 |
| P12 | Harness 版本与证据未完全绑定 | 旧 Run 无法确定使用哪个 checkpoint/evaluator 语义 | Run 创建时没有完整冻结 Harness commit 与证据协议版本 | Pilot 报告已显式披露；后续应成为强制 Run 元数据 |
| P13 | 软隔离能力容易被高估 | 独立 workspace 仍不能阻止 CLI 读取宿主机绝对路径 | 文件隔离不是 OS 权限隔离 | 明确 `file-isolated-development` 不具备排行榜资格；容器列入路线图 |
| P14 | 人效核心数据尚未闭环 | 能看模型产物，却无法证明“大幅提高人效比” | 还未稳定采集人工澄清、测试、微调和返工时间 | 已设计 Human Review；下一阶段应把 touch time 采集设为最高优先级 |

## 5. 哪些做法值得保留

### 5.1 用户持续挑战“这是不是一个真实瓶颈”

这比一开始把 Prompt 写得多完整更重要。产业链双向树降级、股权关系升级、视觉反馈补充，都是在坚持：

> 评测必须覆盖真正消耗工程师时间的困难，而不是寻找模型容易通过的题。

### 5.2 渐进式需求披露

真实产品需求通常不是一开始就有完整 Figma 和严格 Spec。模糊 Brief → 需求澄清 → POC → 反馈 → 生产化，比一次性完整 Prompt 更接近团队工作，也能观察 Requirement Retention 和 Iteration Tax。

### 5.3 失败也保留完整证据

Run 目录、阶段日志、checkpoint、workspace、Session 和报告使以下恢复成为可能：

- 额度恢复后从 S2/S4/S5 继续；
- Pi/Kimi/Codex 故障可以区分 Provider、Harness 和模型实现；
- Revision 可以复用数小时的父 Run 代码；
- 门禁误判可以修正，而不必从头重新消耗 Token。

如果没有这些证据，绝大多数“修复”只能变成重新跑一遍。

### 5.4 确定性门禁优先，人工判断兜底

build、typecheck、test、数据契约、浏览器动作和几何约束适合自动判断；视觉层级、动画节奏和业务表达仍需要人。两者分工比让 Judge 模型给一个总分更可信。

### 5.5 把重复故障升级为平台能力

本轮没有停留在手工处理：

- 额度失败 → Provider failure diagnosis + 可恢复状态；
- 找不到结果 → quick-view；
- 视觉不达标 → Revision；
- 脚本被改 → immutable package gate；
- 文件路径误解 → 更明确的 artifact contract。

这是 Harness 应有的演进方式。

## 6. AI Coding 协作方式复盘

以下评分是基于项目证据的定性判断，不是会话日志自动评分。

| 维度 | 判断 | 证据与改进 |
| --- | --- | --- |
| Task modeling | 较强 | 目标最终从“测 K3”升级为“测产品收敛与人效”；早期 Case 范围有摇摆，但纠偏及时 |
| Context supply | 中上 | 真实仓库、截图和日志逐步补齐；视觉参考介入较晚，说明上下文应按阶段组织 |
| Constraints & acceptance | 较强 | Schema、Rubric、checkpoint、package gate 和隐藏验收较完整；artifact 类型仍需更强 |
| Verification & review | 较强 | 完整 `npm test`、Golden E2E、Playwright 和人工评审协议；真实 Run 的 evaluator attestation 曾缺失 |
| Interaction efficiency | 中等 | 大量问题是在用户运行后逐个暴露，出现多轮“再跑—再诊断”；应通过 preflight 和故障分类前移 |
| Reuse capture | 很强 | Runbook、ADR、Case、Fixture、Evaluator、Revision 和报告均已资产化 |
| Risk governance | 中上 | 明确软隔离、费用确认和秘密不入库；仍需容器隔离、Provider 配额预检和凭据暴露后的轮换流程 |

本轮最需要提升的是 `Interaction efficiency`：

> 不再让操作者替平台做故障分类。CLI 结束时必须直接告诉用户：是否真的完成、失败属于哪一层、已保留什么、下一条安全命令是什么。

## 7. 更合理的下一轮开发顺序

本轮的顺序大致是：

> 完整架构与模块并行建设 → 总集成 → 真实模型运行 → 连续加固

下一轮应调整为：

> 契约最小骨架 → 一个真实模型 × 一个极小 Case 的完整纵切 → 固化状态机/证据/恢复 → 扩到复杂 Case → 再增加 Adapter 和报告能力

具体规则：

1. 每增加一个 Adapter，先通过 L1 小 Case 的 fresh run、quota failure、resume、output bound 四项测试；
2. 每新增一种 artifact，先定义它是逻辑名还是物理路径，并提供 Schema；
3. 每新增一个最终状态，先说明用户下一步能做什么；
4. 每次真实运行强制记录 Harness commit、Case digest、Fixture digest、CLI 版本和模型配置；
5. 每个复杂 Case 首轮运行必须安排人工评审时段，不能只收集机器日志；
6. 没有 Human Touch Time 和业务验收，不生成“大幅提效”结论。

## 8. 下一阶段行动项

### P0：下一轮正式比较前必须完成

| 动作 | 完成标准 |
| --- | --- |
| 建立 Adapter capability/preflight | 对 engine、CLI 版本、model、provider、auth、费用上限、reasoning、resume、图片输入逐项返回明确结果；无效模型在创建收费 Run 前失败 |
| 统一 Run 状态机 | 明确定义 `prepared/running/paused-quota/run-failed/awaiting-evaluation/awaiting-human-review/accepted/rejected`；每个状态有唯一恢复动作 |
| 使 Artifact Contract 类型化 | 区分 symbolic artifact、required path、glob 和 generated manifest；路径型要求由 Harness 模板生成，减少模型猜测 |
| 自动完成 evaluate handoff | 流程门禁通过后直接给出 evaluate/人工评审入口；报告明确当前结论层级 |
| 强制证据版本绑定 | RunSpec 写入 Harness commit、协议版本、Case/Fixture digest 和 Adapter 版本 |
| 采集 Human Touch Time | 分开记录需求澄清、上下文准备、人工评审、修改指令、手工修复和最终验收时间 |
| 建立同口径基线 | 相同 Case 记录“团队当前 Codex 工作流”的人时、轮次、质量和最终验收，不用纯人工假基线替代 |

### P1：提升可靠性和使用体验

- Web 控制台显示 Run 状态、当前阶段、故障分类、恢复按钮和 quick-view；
- 视觉评审页支持参考图、模型产物、Revision 前后图并排；
- 费用和 Token 报告显示完整性，不完整 Run 不参与成本比较；
- 为 quota、429、model-not-found、permission denied、checkpoint mismatch、output overflow 建立固定回归 Fixture；
- 将视觉反馈包标准化为 `feedback.md + references + viewport/state metadata`；
- 把 Revision 次数、每次人工反馈时间和缺陷关闭率计入 Iteration Tax。

### P2：形成可发布的评测能力

- 容器、VM 或专用用户隔离；
- WebGL 语义、性能、内存和资源释放证据；
- 像素/感知对比与人工盲审协同；
- 相同 Harness commit 下的多模型重复运行和方差分析；
- 在证据完整后再考虑排行榜或对外结论。

## 9. 下一轮正式运行检查清单

运行前：

- [ ] Case 确实覆盖真实业务瓶颈，不是简单 Demo；
- [ ] 模型看不到答案仓库和隐藏验收；
- [ ] `bench:doctor` 能验证目标模型与 Provider；
- [ ] Harness commit、Case digest、Fixture digest 已冻结；
- [ ] 预算、墙钟时间、配额恢复策略和停止条件明确；
- [ ] 已安排人工评审人和时间记录方式。

运行中：

- [ ] 每阶段 stdout/stderr 有界增长；
- [ ] Session、checkpoint、workspace 和 attempts 持续落盘；
- [ ] Provider/额度中断进入 paused/resumable，而不是普通失败；
- [ ] 用户无需蹲守确认权限；
- [ ] 不把模型自产检查当 Harness 独立证据。

运行后：

- [ ] CLI/checkpoint、Evaluator、人工验收三层状态分别展示；
- [ ] 最终网页、报告、Ledger、日志可直接打开；
- [ ] Token/费用缺失时显示 unavailable/partial；
- [ ] 记录人工澄清、微调、修复和验收时间；
- [ ] 视觉不达标时创建 Revision 子 Run，不覆盖父 Run；
- [ ] 只有业务接受后才计算有效提效。

## 10. 建议沉淀为仓库长期规则的候选

以下规则值得后续评审后加入项目治理文件，但本次复盘不直接修改 `AGENTS.md`：

1. 新 Adapter 合并前必须有真实小 Case 的 fresh/resume/quota/output-bound 四类证据；
2. 新增 checkpoint 时必须声明 artifact 类型，不允许同一字符串同时表示逻辑名和文件路径；
3. 所有最终状态必须附带一个可执行的下一步；
4. 所有真实 Run 必须绑定 Harness commit 和输入 digest；
5. 任何“提效”结论必须同时具备业务接受、人工基线和 Human Touch Time；
6. 可视化 Case 默认允许二阶段视觉反馈，但 Revision 必须保留父 Run 和已有代码；
7. 密钥若出现在终端粘贴、聊天记录或日志中，应视为已暴露并轮换；仓库只保存 credential reference。

## 11. 对领导任务的最终启示

本轮已经足以给出一个谨慎但有价值的阶段判断：

- Kimi K3 等模型能够独立推进复杂可视化 POC，并完成大量编码、测试和文档工作；
- 它们尚未证明可以免人工完成产品级视觉交付；
- 当前主要瓶颈从“写代码”转移到需求上下文组织、视觉反馈、细节验收和反复收敛；
- 真正有潜力提升人效的，不只是更换模型，而是把需求分阶段、运行恢复、证据采集、视觉反馈和人工验收做成 Harness；
- 下一轮必须测量 Human Touch Time，才能回答“大幅提效、提高人效比”到底成立到什么程度。

因此，`vis-agent-bench` 的价值不应被定义为一个模型排行榜，而应被定义为：

> 把团队与 AI 协作中最耗人的澄清、验证、微调和回归过程变成可执行、可恢复、可度量、可持续优化的工程系统。
