# 移动端雷达图配置修复脚手架

本目录包含移动端雷达图主题解析器的脱敏核心代码。

## 目录结构
- `src/dvRadar.js`: 雷达图主题解析逻辑（包含待修复函数 `parseRadarSysRadius`）。
- `src/utils.js`: 基础辅助函数（`overrideIfUndefined`, `isObject` 等）。
- `test/radar.test.js`: 单元测试。

## 运行测试
```bash
npm test
```
