# 业务 Brief：双图对比气泡自适应边缘避让算法

业务方希望在柱状图与折线图的同比/环比分析卡片中，为末项或激活数据点渲染一个浮动差值气泡（Compare Bubble）。

### 核心痛点
当数据点靠近图表最左侧边缘、最右侧边缘或上下极限位置时，普通的固定方向气泡经常会超出容器边界被裁切破坏。
目前已有一份计算放置逻辑的模块脚手架 `src/placement.js`，需要你实现完整的几何自适应避让算法 `resolveCompareBubblePosition` 与最大可用宽度计算函数 `resolveCompareBubbleMaxWidth`。

### 初始要求
1. 在开始编码前，请先阅读 `src/constants.js` 与 `src/placement.js`，在 `requirement-ledger.yaml` 中记录：
   - 气泡放置（placement）自适应判定与翻转规则；
   - 气泡箭头尖端与锚点圆点之间的间距（gap）与外缘半径几何计算逻辑；
   - 视口超界时的 Clamp 边界限制策略与垂直避让逻辑。
2. 保持纯函数设计，不依赖任何 DOM 环境，确保算法在 Node.js 中可通过单元测试。
