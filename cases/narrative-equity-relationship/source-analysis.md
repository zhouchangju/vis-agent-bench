# 源码反向提取记录

## 分类

- Source Type：Existing implementation extraction
- Extraction Mode：Product Feature Extraction
- Category：data-visualization
- Status：Draft

## 源码边界

| 能力 | 主要证据 |
|---|---|
| DSL、公共 API | `src/types.ts`、`src/index.ts` |
| 数据校验与章节补全 | `src/EquityRelationshipData.ts` |
| 总览/章节布局 | `src/EquityRelationshipLayout.ts`、`src/layout/` |
| SVG 视觉与交互 | `src/EquityRelationshipView.ts`、`src/render/` |
| 动画 DSL | `src/utils/AnimationEngine.ts`、`docs/animation-types.md` |
| 播放与章节状态 | `src/coordinators/`、`src/utils/Playback*` |
| 音频同步 | `src/utils/Audio*`、`docs/audio-playback-sync-plan.md` |
| 真实集成 | `apps/playground/src/pages/EquityTestPage.tsx`、`ChapterTimelinePlayer.tsx` |
| 回归边界 | `test/`、`src/**/__tests__/`、Git 提交历史 |

## 已观察到的真实需求

### 数据与叙事

- 总览、章节、初始引用、后续元素和 timeline 构成 DSL；
- 组织、人物和数据节点具有不同字段和素材；
- 章节问题、字幕、链接、截图和音频参与叙事；
- timeline 会自动补入其引用的总览节点、边和端点。

### 布局

- 层次有向图、自适应 fit、标题高度偏移；
- 总览位置缓存并锚定章节元素；
- 上一步位置优先，防止步骤重绘跳动；
- 长节点标签、角标、边标签均影响实际布局；
- 节点—节点、边—节点、标签—标签三类碰撞处理；
- 同层横向对齐、等视觉间距、减少交叉并为跨层边留通道；
- 边端点必须落在节点图片外边界。

### 动画与状态

- fade、scale、opacity、grow、move、replace、group、group_grow、ungroup；
- scale 强调后恢复；
- replace 中间节点不能提前闪现；
- grow 完成后再显示关系标签；
- 分组、透明度、置灰和隐藏状态必须跨 render 保持；
- 节点置灰级联到连接边；
- 自动镜头聚焦动画目标，但忽略消失类动画。

### 播放与交互

- 总览/章节两种模式；
- 自动播放、暂停恢复、章节与 step 导航、任意章节起播；
- 章节切换继承总览元素和合法分组，并删除孤儿边；
- 音频、动画和显式 step 时长共同决定调度；
- 节点 click/hover、边 click、问题 click、zoom、play/pause、章节和 step 事件；
- 播放完成后返回总览。

### 响应式与工程

- ResizeObserver 驱动容器 Resize；
- 小于阈值时隐藏文本层，保留图形；
- 资源基础路径可配置；
- 支持独立 overview、SVG 查询、缩略图和调试状态；
- destroy 清理播放、音频、状态监听和 DOM。

## 从缺陷历史提取的验收风险

| 风险 | 证据提交 |
|---|---|
| 章节重绘后 dim 丢失 | `6665a8b`、`33b8e1e` |
| 普通 render 覆盖动画透明度 | `54b7f4d` |
| 节点、边、长标签互相遮挡 | `c48b7c3`、`4f00ab2` |
| 边端点进入节点图片或标签 | `9f69c6a`、`1e1401e` |
| replace 节点闪现或重叠 | `17919d4`、`4a1f61e` |
| 章节 ref 与继承规则错误 | `fe6b401`、`c0603ca` |
| 分组后边被错误恢复 | `55a81a0` |
| 节点置灰但连接边未置灰 | `3bafead` |
| grow 后标签/标记布局错误 | `619e7c0`、`fd7322b` |
| 素材弹层出现、滚动和退出时序 | `494eea7`、`5c91d3a` |
| Resize 和小容器可读性 | `115d1e5` |

## 推断与拟议项

- **inferred**：固定截图自动回归、交互自动化和资源清理检查是生产级组件应有验收，
  但源仓库当前自动测试以纯逻辑为主；
- **inferred**：快速章节切换的过期异步任务必须取消，源码已有 transition id 机制；
- **proposed**：将构建、视觉和交互检查收敛成 benchmark Evaluator；
- **proposed**：Fixture 使用脱敏通用实体和素材，不复用原业务答案。

## 未纳入主需求

- Playground 的 JSON 编辑器、调试标签页和测试按钮；
- 业务聊天页面、后端 DSL 生成和鉴权；
- 原项目具体类名、文件拆分、常量值和算法实现；
- 原始真实公司名称、来源 URL 和素材库。

