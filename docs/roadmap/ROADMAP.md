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
- [ ] 创建脱敏 fixture；
- [ ] 将验收契约实现为可执行检查；
- [ ] 建立更严格的 Case Schema 校验。

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
- [ ] 为三个主 Case 建设可运行起始工程和脱敏 fixture；
- [ ] 实际运行一个模型 × 一个 Case 的端到端试验；
- [ ] 确定性 Evaluator；
- [ ] 合并机器证据与人工评审生成 Markdown/HTML 报告；
- [ ] 后续升级容器隔离。

## M3：视觉与性能

- Playwright/Puppeteer；
- Canvas/WebGL 断言；
- 截图比较；
- FPS、内存、资源释放；
- Judge 和人工盲审入口。

## M4：Web 控制台

- 模型配置；
- Case 与 Suite；
- Run 状态；
- 证据查看；
- 横向对比和版本回归。
