# 人工评审与最终报告工作流

## 决策

首期不让系统直接根据自动分数生成领导结论。

流程为：

```text
CLI Run
  → 机器证据包
  → 自动 Build/Test/截图/性能检查
  → 人工视觉与业务评审
  → 人工修复记录
  → 合并生成最终分析报告
```

## 为什么必须人工介入

当前 Case 包含 3D、复杂图表和业务页面复刻。以下内容无法仅靠确定性脚本可靠判断：

- 是否符合视觉层级和设计品质；
- 动画、交互手感和信息密度是否合理；
- 业务表达是否容易理解；
- 代码虽然通过测试，但是否值得合入和继续维护；
- 模型完成了多少，工程师实际需要重做多少。

## 机器先提供什么

- 隔离等级和输入清单；
- CLI 版本、模型、provider、时间和可获得的 Token/费用；
- stdout/stderr 和事件时间线；
- 文件变化、Git diff、构建和测试；
- 固定状态截图、性能与资源数据；
- 自动验收通过/失败项；
- 需要人工确认的问题清单。

## 人工补充什么

每个 Run 填写：

- 业务正确性 1-5；
- 视觉质量 1-5；
- 交互完整性 1-5；
- 可用性与可维护性 1-5；
- accepted / accepted-with-fixes / partial / rejected；
- 需求澄清、上下文/Spec 准备、POC 评审、微调、缺陷修复和最终验收分钟数；
- 澄清轮数、验收前迭代轮数和微调项数；
- 首版 POC 对最终要求的覆盖率；
- must-have 遗漏数和已满足要求的回归数；
- 优点、问题、必须修改项；
- 是否适合替代交付、辅助开发或暂不采用。

结构以 `schemas/human-review.schema.json` 为准。

## 最终报告生成门槛

只有同时存在以下材料才生成领导结论：

1. `result.json`；
2. 自动 Evaluator 结果；
3. `human-review.json`；
4. 人工基线或明确标记“暂无基线”；
5. 隔离等级说明。

缺少人工评审时只生成“机器证据报告”，不计算 Accepted Delivery 和有效人工加速比。

## 当前 Run 的人工评审落位

人工评审文件固定写到 Run 根目录：`<run-dir>/human-review.json`；浏览器证据固定为
`<run-dir>/browser-evidence.json`。不要创建第二套 `review/` 子目录作为报告输入，避免报告生成器
找不到人工结论。

评审时先打开 `workspace/dist/index.html`（或在 `workspace/` 下执行 `npm start` 后访问
`http://localhost:4173`），再结合 `reports/report.html`、`artifacts/workspace.diff` 与阶段日志填写
人工评分。完成后将符合 `schemas/human-review.schema.json` 的 JSON 覆盖写入 Run 根目录，并重新运行
`scripts/generate-report.mjs` 更新报告。

## 报告中的事实分层

- 机器事实：运行时间、代码变化、测试、截图、性能；
- 人工观察：视觉、交互、业务判断；
- 计算结果：人工投入、交付率、有效加速比；
- 管理判断：建议试点、辅助使用或暂不采用。

报告必须显示每项结论的来源，不能把人工判断伪装成自动测量。
