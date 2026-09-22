# Provenance: 3D 球面视锥背面裁剪与屏幕映射引擎

## 1. 来源与血统
- **上游代码库**：`standard-chart`
- **原始子包与文件**：
  - `packages/paradigm-3d-globe/src/layer/tooltip/tooltipLayout.ts`
  - `packages/paradigm-3d-globe/src/util/three.ts`
- **业务场景**：3D 全球宏观态势地图 / 球面大屏可视化中的 3D 浮层布局与视锥背面剔除。
- **采集时间**：`2026-09-22`

## 2. 脱敏与切片说明
- 提炼了 3D 球面解析几何计算（视线切点切线极限距离公式 $D_{edge} = \sqrt{D_{pov}^2 - R^2}$、透视缩放比插值、LookAt 观察矩阵与屏幕像素映射）；
- 剥离了庞大的 `globe.gl` 与 WebGL 渲染宿主环境，抽离出轻量无依赖的纯 ESM 3D 数学模块 `math3d.js`；
- 初始 Starter 模版暴露函数签名与几何公式注释，将视锥背面裁剪与投影实现留给 Agent 完成；
- 隐藏验收评测脚本使用精确几何向量矩阵测试，与模型 prompt 彻底隔离。
