# 3D Globe Backface Occlusion & Screen Projection Engine

该脚手架包含 3D 球面几何计算基础模块与遮挡裁剪排版接口。

## 目录结构
- `src/math3d.js`: 三维向量 `Vector3` 与球坐标经纬度转换基础数学库。
- `src/occlusion.js`: 背面遮挡剔除、透视缩放、屏幕坐标映射与浮层排版算法实现。
- `test/occlusion.test.js`: 单元自测脚本。

## 运行测试
```bash
npm test
```
