# Provenance: 移动端雷达图半径配置覆盖缺陷排查

## 1. 来源与血统
- **上游代码库**：`standard-chart`
- **原始文件**：`packages/paradigm-chart/src/theme/mobile/series/dvRadar.ts`
- **历史真实提交**：
  - Commit SHA: `f31b2bf622173978b323e2332a53233195783141`
  - 提交信息：`A5-1204 fix 修复雷达图的雷达坐标系半径radar.radius中用户配置无法覆盖主题配置的问题`
  - 提交日期：`2025-11-25`

## 2. 脱敏与切片说明
- 剥离了 ECharts 的大型外部打包依赖，仅保留核心主题解析与选项合并逻辑；
- 将 TypeScript 编译依赖转化为免构建的纯原生 ESM JavaScript 代码，以便在零依赖沙箱中直接使用 `node --test` 执行秒级自测与自动化验证；
- 初始 Starter 代码精准还原提交前的 Bug 状态。
