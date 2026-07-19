# VAB-T07：报告生成器

```prompt
你负责 vis-agent-bench 的 VAB-T07，只实现机器证据 + 人工评审的报告生成器。

仓库：/Users/leozhou/git/vis-agent-bench
建议分支：codex/vab-t07-reporting
依赖：VAB-T00 已合入。

先读取：
- AGENTS.md
- docs/agent-orchestration/CONTROL_PROTOCOL.md
- docs/design/EFFICIENCY_EVALUATION.md
- docs/design/HUMAN_REVIEW_WORKFLOW.md
- prototype/report.html
- schemas 中的 Run/Evaluation/Human Review 契约

允许修改：
- src/reporting/**
- scripts/generate-report.mjs
- tests/reporting/**
- schemas/report.schema.json
- prototype/report.html
- docs/reports/**
- docs/agent-orchestration/evidence/VAB-T07.md

目标：
从若干 Run 的机器结果和人工补充生成 JSON、Markdown、HTML 三种报告。报告必须直接回答：
模型是否达到业务门槛、相对当前 Codex 基线减少了多少人工投入、节省发生在哪里、风险在哪里。

必须交付：
1. 报告输入/输出 Schema 和稳定的聚合函数。
2. 单 Run、同 Case 多模型、同模型多 Case 三种视图。
3. Accepted Delivery 之前不计算“有效提效”。
4. Human Touch Time 分解：需求澄清、上下文准备、POC 评审、视觉微调、缺陷回归、最终验收。
5. token/cost 缺失时显示 unavailable，不猜测。
6. 区分事实、人工判断、推断和未验证项。
7. 领导摘要、能力边界、Case 结论、失败模式、建议动作和证据链接。
8. 示例数据醒目标注 DEMO，不能混入真实排行榜。
9. 快照测试和缺失/冲突输入测试。

不要执行模型、浏览器或 evaluator。验收：
- 本任务测试
- 用固定样例生成 JSON/Markdown/HTML
- report schema validation
- npm test
- git diff --check

完成后只提交本任务文件，不 push，按统一 JSON 回传并列出尚未接入的真实数据源。
```

