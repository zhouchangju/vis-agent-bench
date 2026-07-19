# Fixture 待办

- 从真实示例生成脱敏锂离子电池产业链数据；
- 增加单侧为空、层级不对称、深层、重复名称和长文本；
- 增加缺失、零值和极端涨跌；
- 保存桌面、窄容器、亮暗主题和展开状态参考图；
- 正式任务不能直接复制当前 StandardChart 工作树，因为当前仓库和 Git 历史都含现成实现；
- 从固定当前基线执行 `git archive`，不携带 `.git`；
- 删除 `src/extension/series/dvTwoWayTree/`、现成示例、文档、测试、搜索索引和所有可还原答案的构建产物；
- 应用一份仅用于“移除注册引用并恢复可编译”的 baseline patch，不包含布局或交互答案；
- Fixture Builder 必须输出 answer-exclusion manifest 和文件哈希；
- 在启动 Agent 前验证清洗后的基线能够 build、lint、test；
- 隐藏验收使用控制面保存的真实实现和历史缺陷作为参考，不挂载到 Worker。
