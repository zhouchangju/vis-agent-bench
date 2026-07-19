# VAB-T12：Macro Map 3D 确定性 Evaluator

```prompt
你负责 VAB-T12，只实现 Macro Map 3D Case 的确定性 Evaluator。读取 T04/T09/T11 的 API、证据、
Case requirement/acceptance/rubric。允许修改 task catalog 中 VAB-T12 的 allowed_paths。

将 build、输入校验、无 uncaught error、数据映射、相机/交互状态、聚合切换、选择与 tooltip、
resize、降级行为、基本性能预算及可自动判断的画布状态做成稳定检查。使用真实浏览器证据但不对
像素风格、镜头美感、动画观感作伪精确判断；这些列入人工评审。Rubric ID 必须与检查一一对应。
测试同时证明最小合规实现可通过、故意错误实现会失败。提交独立 commit，不 push，并附 evidence。
```
