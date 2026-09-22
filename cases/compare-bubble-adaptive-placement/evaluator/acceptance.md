# 隐藏验收契约：双图对比气泡自适应边缘避让算法

## P0 核心验收点
1. **自动侧向选择（Auto Placement）**：
   - 当锚点在右侧（如 `anchorX: 95, bounds.right: 120`）时，能容纳于左侧，`side` 必须为 `'left'`；
   - 当锚点在左侧（如 `anchorX: 15, bounds.left: 0`）时，左侧放不下，必须自动翻转为 `'right'`。
2. **显式声明方向与超界翻转**：
   - 显式声明 `placement: 'left'` 但左侧放不下且右侧放得下时，自动翻转为 `'right'`；
   - 显式声明 `placement: 'right'` 但右侧放不下且左侧放得下时，自动翻转为 `'left'`。
3. **坐标精确度与间隙净空**：
   - 水平坐标 `left` 必须计入圆点半径 `COMPARE_DOT_RADIUS` 与箭头偏移量 `COMPARE_BUBBLE_ARROW_OFFSET`，且箭头尖端与圆点外缘相距恰好等于 `gap`。
   - `left` 必须被严格 Clamp 限制在 `[bounds.left + padding, bounds.right - padding - width]` 内部，绝对不溢出容器。
4. **垂直避让与辅助线防遮挡**：
   - 默认垂直居中 `top = anchorY - height / 2`；
   - 当传入 `guideYs: [upperY, lowerY]` 且两线间距小于气泡高度时，能正确避让为 `vertical: 'above'` 或 `'below'`，且 `top` 不溢出上下边界。
5. **视口极端过小保护**：
   - 当容器总可用尺寸小于气泡尺寸时，返回 `{ visible: false }`。
6. **最大宽度计算**：
   - `resolveCompareBubbleMaxWidth` 能根据当前 `anchorX` 正确返回左右两边可用净空宽度的较大值。
