# 首批 Case 候选池

当前候选尚未成为正式 benchmark。

## 选择方式

| 方向 | 当前数量 | 选择目标 |
|---|---:|---:|
| 从零 3D | 1 | 已选择 `CAND-3D-001` |
| 复杂关系叙事可视化 | 1 | 已选择真实项目 `narrative-graph` |
| StandardChart 业务组件 | 4 | `CAND-SC-001` 降为备选 |
| StandardChart TODO / 存量维护 | 4 | 首期暂缓 |
| 已上线业务复刻 | 1 | 已选择 `CAND-SHOT-HEATMAP-001` |

选定后才会创建：

```text
cases/<case-id>/
├── case.yaml
├── scenario/
│   ├── initial-brief.md
│   └── stages.yaml
├── prompt/requirement.md
├── prompt/clarifications.yaml
├── fixture/
├── evaluator/acceptance.md
├── evaluator/rubric.yaml
└── provenance.md
```

`scenario/` 是模型按轮次看到的内容；`prompt/requirement.md` 已转为内部完整需求真相，
不会在运行开始时一次性投喂。

## 候选文档

- [从零 3D](3D_GREENFIELD.md)
- [StandardChart 业务组件](STANDARD_CHART_COMPONENTS.md)
- [StandardChart TODO](STANDARD_CHART_TODOS.md)
- [AInvest Market Heatmap 业务复刻](SCREENSHOT_RECONSTRUCTION.md)
- [真实项目 (gitlab-outer) 挖掘候选池与初期评测梯队](GITLAB_OUTER_MINED_CANDIDATES.md)

## 首期决策与初期试跑梯队

根据最新分类分级与深度挖掘结果，初期优先采用以下覆盖四级难度的 5 个核心基准任务：

1. **🥉 入门与校准（Bronze）**：`radar-radius-override-bugfix`（移动端雷达图半径配置覆盖缺陷，10 行纯逻辑修复，来自 `standard-chart`）；
2. **🥈 日常业务主力（Silver）**：
   - `compare-bubble-adaptive-placement`（双图对比气泡自适应边缘避让算法，来自 `datav-aigc-vis-adapter`）；
   - `datazoom-pointer-race-lock`（DataZoom 拖拽与坐标轴指示器穿透竞态拦截，来自 `standard-chart`）；
3. **🥇 专家生产级（Gold）**：`ainvest-market-heatmap-rebuild`（AInvest 市场热力图业务复刻）；
4. **💎 技术底座攻坚（Diamond）**：`3d-globe-backface-occlusion`（3D 球面空间投影与视锥体背面遮挡裁剪引擎，来自 `standard-chart/packages/paradigm-3d-globe` `tooltipLayout.ts`）。

其他挖掘出的任务（时间轴末项标签重叠、蜂群图实体选择、并购重组流向图、万级节点四叉树裁剪、分时图光标对齐等）作为备选池固化在 [GITLAB_OUTER_MINED_CANDIDATES.md](GITLAB_OUTER_MINED_CANDIDATES.md) 中备用。

