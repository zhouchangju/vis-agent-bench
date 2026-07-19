# VAB-T09：Macro Map 3D 脱敏 Fixture

```prompt
你负责 vis-agent-bench 的 VAB-T09，只实现 Macro Map 3D 主 Case 的脱敏 Fixture。

工作树路径由总控提供。真实参考代码只读：
/Users/leozhou/git/test/test-vis-case/guidelines

先读取 AGENTS.md、CONTROL_PROTOCOL、T02 evidence、该 Case 的 requirement/scenario/rubric/provenance，
以及 Fixture Builder API。只抽取可泛化的 3D 工程约束、交互和数据形态，禁止复制真实业务代码、
内部标识、私有资源、答案实现或路径线索。

允许修改：
- cases/macro-map-3d-greenfield/fixture/**
- scripts/fixtures/macro-map-3d/**
- tests/cases/macro-map-3d/**
- docs/agent-orchestration/evidence/VAB-T09.md

交付一个可直接交给被测 Agent 的最小 Starter、合成公开数据、边界数据、隐藏非法输入、生成型本地
资源、fixture plan、验证脚本和测试。Starter 必须 build/typecheck/test 可运行，但不得包含 3D 答案。
覆盖高密度点位、分层/聚合、相机初始状态、缩放旋转、hover/selection、时间或指标切换、resize、
WebGL 不可用降级等需求所需的数据契约。验证泄漏扫描确实为 0。

完成后提交一个独立 commit，不 push；回传 commit、命令、证据和 not_proven。
```
