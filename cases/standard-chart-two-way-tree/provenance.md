# 来源

- 仓库：`/Users/leozhou/git/standard-chart/packages/paradigm-chart`
- 真实示例：`examples/test/series/ainvest/pc/twoWayTree.js`
- 历史证据：`f7c74483`、`94c2a1c3`
- 双向树首次实现提交：`c2d5a3a7fffc789a06bbce73965ca2a59b72a5af`（2022-09-22）

正式任务使用合成 Starter（`fixture/starter/`），其中不含任何真实业务代码、
Git 历史或现成双向树实现，作为 Agent 起点而非历史回滚基线：

- `fixture/plan.yaml` 声明 baseline gate（build/typecheck/test）与 leakage 规则，
  通过 Fixture Builder 输出 answer-exclusion manifest 与文件 SHA-256；
- `fixture/starter/public/assets/sample-data.json` 是合成的产业链节点/边样本，
  覆盖上/下游、不对称深度、空侧、缺失/零/极端指标、长文本和重名边界；
- `evaluator/rubric.yaml` 是 v1 确定性 rubric，`evaluator/OBSERVATION_CONTRACT.md`
  描述观测契约与人类评审边界；
- `src/evaluators/cases/standard-chart-two-way-tree/` 实现工厂与每个 check id 的
  确定性 assertion，并通过 `src/control-plane/case-registry.mjs` 注册为 backup case
  （不进入 PRIMARY_CASES，需显式调用才会运行）。

真实实现仅作为隐藏控制证据来源，不挂载到 Worker。
