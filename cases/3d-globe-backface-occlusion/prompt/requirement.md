# 完整需求真相：3D 球面视锥背面裁剪与屏幕映射引擎

## 1. 业务目标与背景
在 3D 数字地球 / 球面大屏可视化中，当相机围绕以原点 $(0, 0, 0)$ 为中心的地球（半径 $R$）旋转漫游时，必须精确剔除位于球体背面视锥遮挡区域的经纬度点位与 HTML 浮层标记，并为可视浮层计算透视视距缩放与二维屏幕像素坐标 $(X_{screen}, Y_{screen})$。

## 2. 核心算法与几何推导规范

### A. 球面空间遮挡判定 (`isPointOccludedBySphere`)
函数签名：`isPointOccludedBySphere(point, cameraPosition, globeRadius)`
- **几何参数**：
  - 球心位于世界坐标系原点 $\mathbf{O} = (0, 0, 0)$，半径为 $R = globeRadius$。
  - 相机位置为 $\mathbf{P}_{cam}$，目标点位置为 $\mathbf{P}_{target}$。
  - 相机到球心距离：$D_{pov} = \|\mathbf{P}_{cam}\|$。若 $D_{pov} \le R$，视为相机在球体内（返回 `occluded: false`）。
  - 相机到球体轮廓切线的视线极限距离（切点距离）：
    $$D_{edge} = \sqrt{D_{pov}^2 - R^2}$$
  - 目标点到相机的欧式距离：$D_{pos} = \|\mathbf{P}_{cam} - \mathbf{P}_{target}\|$。
- **遮挡条件**：
  - 对于球面上点（$\|\mathbf{P}_{target}\| \approx R$）：
    若 $D_{pos} > D_{edge}$，则该点处于相机切线锥体背面，被球体自身遮挡（`occluded: true`）；否则可视（`occluded: false`）。
  - 返回对象格式：
    ```js
    {
      occluded: boolean,
      povDist: number,     // D_pov
      povEdgeDist: number, // D_edge
      povPosDist: number   // D_pos
    }
    ```

### B. 透视视距缩放 (`computePerspectiveScale`)
函数签名：`computePerspectiveScale(povPosDist, povDist, globeRadius, options = {})`
- **参数默认值**：`perspectiveMaxScale = 1.0`, `perspectiveMinScale = 0.4`。
- **几何推导**：
  - 最近可见视距（球体正对相机最近极点）：$D_{center} = D_{pov} - R$。
  - 最远可见视距（地平线切点处）：$D_{edge} = \sqrt{D_{pov}^2 - R^2}$。
  - 线性距离归一化因子：$t = \frac{D_{pos} - D_{center}}{D_{edge} - D_{center}}$。
  - 将 $t$ 限制在 $[0, 1]$ 范围内（使用 Clamp）。
  - 缩放系数：
    $$scale = perspectiveMaxScale - t \times (perspectiveMaxScale - perspectiveMinScale)$$
  - 返回值保留在 $[perspectiveMinScale, perspectiveMaxScale]$ 区间内。

### C. 3D 球面点至 2D 屏幕投影 (`projectSpherePointToScreen`)
函数签名：`projectSpherePointToScreen(point, camera, screen, globeRadius = null)`
- **相机与视口定义**：
  - `camera`: `{ position, target = (0,0,0), fov = 50, aspect = screen.width / screen.height, up = (0,1,0) }`
  - `screen`: `{ width, height }`（例如 800 x 600）
- **投影步骤**：
  1. 若传入 `globeRadius` 且 `isPointOccludedBySphere(point, camera.position, globeRadius).occluded === true`，则直接返回 `{ visible: false, occluded: true }`。
  2. 构建 LookAt 观察坐标系：
     - 观察视线方向：$\vec{forward} = \text{normalize}(target - camera.position)$。
     - 水平向右方向：$\vec{right} = \text{normalize}(\vec{forward} \times camera.up)$。
     - 垂直向上方向：$\vec{camUp} = \vec{right} \times \vec{forward}$。
  3. 目标点向量 $\vec{v} = point - camera.position$。
     - 视线深度：$z_{view} = \vec{v} \cdot \vec{forward}$。若 $z_{view} \le 0$，目标点在相机后方，返回 `{ visible: false, occluded: false }`。
     - 水平投影分量：$x_{view} = \vec{v} \cdot \vec{right}$。
     - 垂直投影分量：$y_{view} = \vec{v} \cdot \vec{camUp}$。
  4. 透视投影至标准化设备坐标 (NDC: $[-1, 1]$)：
     - 半视场角正切：$\tanHalf = \tan(\frac{fov \times \pi}{360})$。
     - $ndc_y = \frac{y_{view}}{z_{view} \times \tanHalf}$。
     - $ndc_x = \frac{x_{view}}{z_{view} \times \tanHalf \times camera.aspect}$。
     - 若 $|ndc_x| > 1$ 或 $|ndc_y| > 1$，说明在相机视锥外（`visible: false`）。
  5. 屏幕物理像素坐标映射（原点位于屏幕左上角）：
     - $screenX = (ndc_x \times 0.5 + 0.5) \times screen.width$
     - $screenY = (-ndc_y \times 0.5 + 0.5) \times screen.height$
  6. 返回 `{ visible: true, occluded: false, screenX, screenY, ndc: { x: ndc_x, y: ndc_y } }`。

### D. 浮层批量排版引擎 (`layoutSphereTooltips`)
函数签名：`layoutSphereTooltips(items, globeOptions)`
- 每个数据项具有经纬度 `{ id, lat, lng, altitude, width, height }` 或空间点位 `point`。
- 批量处理流水线：
  1. 通过 `latLngToVector3` 转换为 3D 空间向量；
  2. 进行背面遮挡判定，剔除背面项（标记 `visible: false`）；
  3. 针对可见项，计算透视 `scale` 与屏幕坐标 `(screenX, screenY)`；
  4. 根据视口内边距 `padding: [top, right, bottom, left]` 检查边界溢出；
  5. 最终返回所有数据项的处理结果列表。
