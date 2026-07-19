# VAB-T13：AInvest Heatmap 确定性 Evaluator

```prompt
你负责 VAB-T13，只实现 AInvest Heatmap Case 的确定性 Evaluator。读取 T04/T10/T11 的 API、证据、
Case requirement/acceptance/rubric。允许修改 task catalog 中 VAB-T13 的 allowed_paths。

将 build、输入校验、无 uncaught error、面积权重误差、颜色尺度与 legend、层级钻取、tooltip、
搜索/筛选、空态、resize、键盘可达性及高密度标签的可自动判断部分做成稳定检查。真实浏览器证据
用于行为和状态，不把视觉审美伪装成机器真相。Rubric ID 与检查一一对应。测试同时证明最小合规
实现可通过、故意错误实现会失败。提交独立 commit，不 push，并附 evidence。
```
