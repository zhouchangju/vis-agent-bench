# 路线图

## M0：候选选择

- [x] 初始化仓库；
- [x] 确定需求粒度原则；
- [x] 提取首批候选池；
- [x] 将截图题替换为 AInvest Market Heatmap 已上线业务复刻；
- [x] 增加瓶颈型 Case 准入和质量优先的人效口径；
- [x] StandardChart 业务组件选择产业链双向树；
- [x] 将真实股权关系叙事可视化升级为主 Case，产业链双向树降为备选；
- [x] 决定首期暂缓 StandardChart TODO；

## M1：Case 契约

- [x] 为 3 个主 Case 和 1 个备选 Case 创建正式 Case 骨架；
- [x] 生成模型可见需求；
- [x] 生成澄清答案库；
- [x] 创建隐藏验收和评分契约；
- [x] 将三个 Case 改造成模糊 Brief → POC → 反馈 → 验收的阶段剧本；
- [x] 为三个主 Case 创建脱敏 fixture；
- [x] 将三个主 Case 的验收契约实现为可执行确定性检查；
- [x] 建立严格的 Case / RunSpec / Rubric Schema 校验。

## M2：CLI MVP

- [x] 将剩余开发拆成带依赖、写路径和验收契约的多 Agent 原子任务；
- [x] Codex、Kimi Code、Claude Code CLI 能力探测；
- [x] 三类 CLI Adapter 命令构建；
- [x] 文件级软隔离 Run 目录；
- [x] 答案泄漏扫描；
- [x] 原始日志、归一化事件、文件快照和 Git diff 采集骨架；
- [x] 人工评审 Schema 和网页原型；
- [x] 三类 CLI 的多阶段会话构建和逐阶段日志目录；
- [x] 将当前 Codex + 主力 GPT 工作流设为主比较基线；
- [x] 为三个主 Case 建设可运行起始工程和脱敏 fixture；
- [x] 实际运行多个模型 × 复杂 Case 的端到端开发 Pilot；
- [x] 确定性 Evaluator；
- [x] Playwright 真实 Chromium 证据与显式访问策略；
- [x] 合并机器证据与人工评审生成 Markdown/HTML 报告；
- [x] 三个主 Case 的 deterministic golden E2E 与 checkpoint 恢复；
- [x] 设置页按同一契约导出 RunSpec；
- [x] 支持长任务断点恢复、额度暂停诊断与视觉反馈 Revision 子 Run；
- [ ] 后续升级容器隔离。

## M3：视觉与性能

- [x] Playwright / Chromium 控制面；
- [x] DOM、交互、截图与 Canvas 可观察状态证据；
- [ ] WebGL 语义正确性；
- [ ] 像素/感知截图比较；
- [ ] FPS、内存、资源释放；
- [x] 人工盲审数据契约和入口原型；
- [ ] Judge 模型复核。

## M4：Web 控制台

- [x] 模型、Case、联网、预算与 Evidence 设置页原型；
- [x] RunSpec 导出；
- [ ] Run 状态；
- [ ] 证据查看；
- [ ] 横向对比和版本回归。

## M5：任务分类分级与核心阶梯案例库 (Wave 8 Phase 1)

- [x] 制定任务分类分级与本地轻量防作弊设计规范 (`docs/design/TASK_TAXONOMY_AND_LOCAL_ISOLATION.md`)；
- [x] 拆解 Wave 8 多 Agent 子任务编排（VAB-T17 ~ VAB-T22）；
- [x] VAB-T17 任务分类与难度分级元数据规范与校验（支持 6 大任务类型与 Bronze/Silver/Gold/Diamond 四级难度阶梯）；
- [x] VAB-T22 首批分级典型案例库补齐与全流程验证：
  - [x] 🥉 Bronze（入门与校准）：`cases/radar-radius-override-bugfix`（移动端雷达图半径配置覆盖缺陷修复）；
  - [x] 🥈 Silver（日常业务主力）：`cases/compare-bubble-adaptive-placement`（双图对比气泡自适应边缘避让算法）；
  - [x] 🥇 Gold（专家生产级）：`cases/ainvest-market-heatmap-rebuild`（AInvest 市场热力图 Treemap 业务级复刻）；
  - [x] 💎 Diamond（技术底座攻坚）：`cases/3d-globe-backface-occlusion`（3D 球面视锥背面遮挡裁剪引擎与屏幕映射）；
  - [x] 4 梯度自动化测试套件全绿闭环（`npm run test:cases`）。

## M6：本地轻量沙箱与防作弊体系 (Wave 8 Phase 2)

- [ ] VAB-T18 本地轻量隔离与 Fake HOME 沙箱引擎 (免 Docker / macOS 原生 `sandbox-exec` 配置文件生成 / 环境变量漂白)；
- [ ] VAB-T19 场外独立验收与物理隔离评测 Harness (将 workspace 拷贝与 evaluator 物理脱耦，防窥探隐藏测试脚本)；
- [ ] VAB-T20 金丝雀探针与越权审计器 (工作区边缘与敏感系统路径探针注入，违规窥探立即 0 分熔断)；
- [ ] 验证沙箱下的完整隔离有效性（阻断跨目录探测真实 GitLab 仓库与历史提交）。

## M7：真实 Agent 4 梯度真机跑分与基准评测 (Wave 9)

- [ ] VAB-T23 真实模型 4 梯度端到端跑分 Harness：
  - [ ] Codex (GPT-5.6 / 6) 在 Bronze ~ Diamond 上的完整运行与解题率统计；
  - [ ] OpenCode (DeepSeek / MiMo / GLM) 在 4 梯度上的真实表现横向对比；
  - [ ] 记录 Token 消耗、时间预算、重试轮数、通过率与质量门禁得分；
  - [ ] 产出第一份综合性能与效率可视化基准白皮书/评测报告。

## M8：自动化题目摄入与持续题库扩充 (Wave 10)

- [ ] VAB-T21 真实题目采集转换流水线与脚手架 CLI (`scripts/intake-case.mjs`)：
  - [ ] 交互式/参数化一键创建符合规范的 Case 骨架（case.yaml、scenario、prompt、fixture、evaluator、provenance）；
  - [ ] 集成自动化敏感信息/答案泄漏静态扫描门禁。
- [ ] 备选案例池分批入库：
  - [ ] DataZoom 快速拖拽竞态拦截（Silver: `datazoom-race-condition-guard`）；
  - [ ] 紧凑时间轴末项标签避让重叠（Silver: `timeline-last-label-overlap`）；
  - [ ] 蜂群图高频悬浮实体选择算法（Gold: `swarm-entity-selection-algo`）；
  - [ ] 万级节点四叉树视锥剔除与 LOD 渲染（Diamond: `quadtree-lod-culling`）。


