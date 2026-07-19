# AInvest Market Heatmap 业务复刻

## 背景

参考 AInvest 已上线的 Market Heatmap，开发一个数据驱动的市场热力地图。用户需要在一屏内观察板块和标的涨跌，并切换市场、数据范围、面积、颜色和分组。

参考页面：<https://www.ainvest.com/market/heatmap/>

我们提供脱敏 Mock API 和项目脚手架。不能使用截图贴图或硬编码矩形位置。

## P0：Stock 主闭环

- 支持 S&P 500、NASDAQ 100、NASDAQ Composite、NYSE、All Stocks、Dow Jones；
- 面积可按市值或等面积；
- 颜色至少支持日涨跌幅，正确处理正、负、零、空值和极端值；
- 支持按 Sector 分组或不分组；
- 节点根据面积自适应展示 Symbol、涨跌和 Logo；
- Tooltip 展示名称、代码、价格、市值及当前颜色指标；
- 点击板块进入板块并可返回，点击标的触发详情事件；
- Resize 后保持面积关系、分组和钻取状态；
- 提供 loading、empty、error、retry。

## P1：多市场与设置

- 支持 Stock、ETF、Crypto；
- ETF 面积按 AUM，可按 Asset Class 分组；
- Crypto 支持包含/排除 BTC，面积按市值；
- 不同市场使用各自可用的时间范围和颜色深度；
- 支持 Logo、标题、数值和颜色方案设置；
- 支持全屏并保持状态；
- 主要筛选可通过 URL 或等价方式恢复。

## P2：生产化

- 明暗主题和桌面、窄屏、全屏响应式；
- 大数据下缩放、Tooltip、钻取、筛选和 Resize 保持流畅；
- 快速切换时过期请求不能覆盖最新状态；
- 不重复绑定事件或泄漏图表实例；
- 交付类型、数据转换单测、关键交互测试和视觉回归。

实现说明需要记录数据映射、Treemap 方案、色阶策略、响应式策略和未完成项。
