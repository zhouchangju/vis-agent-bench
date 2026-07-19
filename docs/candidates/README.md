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

## 首期决策

- 从零 3D：`CAND-3D-001`；
- 复杂组件：真实项目 `narrative-graph` 中的股权关系叙事可视化；
- 业务复刻：`CAND-SHOT-HEATMAP-001`；
- StandardChart 业务组件：`CAND-SC-001` 产业链双向树保留为备选；
- StandardChart TODO：本期不进入正式 Case。

其他候选保留在候选池，不删除、不转为正式 Case。
