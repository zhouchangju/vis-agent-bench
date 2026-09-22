# Provenance: 双图对比气泡自适应边缘避让算法

## 1. 来源与血统
- **上游代码库**：`datav-aigc-vis-adapter`
- **原始文件**：`common/compare/placement.js` 与 `tests/compare-contracts.mjs`
- **历史真实提交**：
  - Commit SHA: `160b189b1c33ad87c0fac715724bba99991d07c6`
  - 提交信息：`A5-1386 fix 对比气泡自适应避让`
  - 提交日期：`2026-08-27`

## 2. 脱敏与切片说明
- 提取了纯几何放置算法函数及相关基础几何常量；
- 剥离了 Vue / 外部图表库打包逻辑，封装为独立纯 ESM 模块；
- 初始 Starter 脚手架提供函数类型声明与基础结构，留空核心放置判定算法留给模型实现。
