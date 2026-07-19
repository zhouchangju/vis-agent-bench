# VAB-T14：真实模型端到端 Pilot

```prompt
在 T08 accepted 后执行小规模真实模型 Pilot。不得修改 Harness 核心代码，只提交配置、运行产物、
报告和 evidence。先用单一 Case 做 smoke，确认隔离、预算、日志和恢复；再分别调用可用的 Codex、
Kimi Code、Claude Code CLI。记录 CLI/version/model（无法确认时明确 unknown/default）、开始结束
时间、退出码、估算或原生 token/cost 字段、产物 diff、确定性评估、浏览器证据和人工评审待办。
不因某 CLI 缺少 token 数据而伪造数字，使用 unavailable + 原因。任何真实模型运行不得读取答案
仓库，只能进入导出的 fixture workspace。最终生成横向可比的 pilot 报告并说明样本量边界。
```
