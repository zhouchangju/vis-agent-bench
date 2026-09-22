# 完整需求真相：双图对比气泡自适应边缘避让算法

## 1. 业务目标
为图表对比浮动气泡提供精确且健壮的几何布局引擎，避免在小屏、容器缩放或极值点处发生溢出裁切或遮挡对比辅助线。

## 2. 算法规范与几何常量
从 `src/constants.js` 导入以下几何常量：
- `COMPARE_DOT_RADIUS`: 锚点圆点半径（3.5px）
- `COMPARE_BUBBLE_BORDER`: 气泡边框（0.5px）
- `COMPARE_BUBBLE_ARROW_OFFSET`: 箭头外探偏移量（3.25px）

### A. 容器边界计算
- `leftBound = bounds.left + safePadding`
- `rightBound = Math.max(leftBound, bounds.right - safePadding)`
- `topBound = bounds.top + safePadding`
- `bottomBound = Math.max(topBound, bounds.bottom - safePadding)`
- 若可用宽度 `< width` 或 可用高度 `< height`，则返回 `{ visible: false, left: leftBound, top: topBound, side: 'left', vertical: 'middle' }`。

### B. 水平侧向选择（side）
- 锚点净空：`anchorClearance = safeGap + COMPARE_DOT_RADIUS`
- 左侧可容纳条件：`canFitLeft = anchorX - anchorClearance - width >= leftBound`
- 右侧可容纳条件：`canFitRight = anchorX + anchorClearance + width <= rightBound`
- 规则：
  - `placement === 'auto'`: `canFitLeft || !canFitRight ? 'left' : 'right'`
  - 显式声明 `left` 但放不下且右侧能放下时：翻转为 `right`
  - 显式声明 `right` 但放不下且左侧能放下时：翻转为 `left`

### C. 水平位置坐标（left）
- 若 `side === 'left'`：
  `anchorX - anchorClearance - width + COMPARE_BUBBLE_BORDER - COMPARE_BUBBLE_ARROW_OFFSET`
- 若 `side === 'right'`：
  `anchorX + anchorClearance - COMPARE_BUBBLE_BORDER + COMPARE_BUBBLE_ARROW_OFFSET`
- 最终 Clamp 约束：`left = Math.max(leftBound, Math.min(left, rightBound - width))`

### D. 垂直位置坐标（top & vertical）
- 默认：`top = anchorY - height / 2`, `vertical = 'middle'`
- 当 `avoidOverlap === true` 且传入排序后的辅助线高度 `guideYs: [upperY, lowerY]` 时：
  - 若 `lowerY - upperY >= height + safeGap * 2`，居中放置：`top = (upperY + lowerY - height) / 2`
  - 若中间放不下，优先避让到上方：若 `upperY - topBound >= height + safeGap`，则 `top = upperY - height - safeGap`, `vertical = 'above'`
  - 否则若下方空间充足：若 `bottomBound - lowerY >= height + safeGap`，则 `top = lowerY + safeGap`, `vertical = 'below'`
- 最终 Clamp 约束：`top = Math.max(topBound, Math.min(top, bottomBound - height))`

### E. 最大可用宽度函数
`resolveCompareBubbleMaxWidth({ anchorX, bounds, padding, gap })` 计算左右两侧中较大的可用净空宽度。
