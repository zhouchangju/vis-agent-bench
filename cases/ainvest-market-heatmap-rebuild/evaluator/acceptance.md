# 隐藏验收

## 证据边界

Evaluator 只把可重放的命令结果、数据映射快照、DOM/事件/状态 observation 和真实浏览器
manifest 当作机器证据。截图只作为人工 Review artifact；截图存在、Canvas 非空或颜色字符串
本身都不能证明 Treemap 语义或审美质量。

`rubric.yaml` 中每个 check ID 必须且只能映射到一个确定性 assertion。缺少 observation
时不得猜测通过，Evaluator 应把输入判为无效或由 Core 标记为未执行。

## 关键失败

- build/typecheck/test 失败，或完整 fixture 触发 uncaught error；
- 使用截图、Canvas 位图或硬编码坐标伪装数据驱动 Treemap；
- 面积归一化误差超出 2 个百分点，或等面积模式并非等权；
- 正负、零、空值或极端值没有遵循同一色阶域与 clamp 规则；
- Stock 主闭环钻取/返回、Resize 状态保持不可用。

## 可确定性判断

- 六种 Stock scope；Stock/ETF/Crypto 的面积和分组规则隔离；
- 市值/AUM/等面积权重、组汇总和显式 null-area fallback；
- 颜色值到归一化色阶位置的映射，以及 legend 与同一 domain 的一致性；
- Tooltip 字段，板块钻取/返回，标的结构化事件，搜索/筛选；
- loading/empty/error/retry，筛选状态恢复，Resize 前后业务状态；
- stale request、生命周期清理、键盘到达与 Enter/Space 激活；
- 高密度标签是否按确定规则降级、无溢出且仍可通过 Tooltip 获取信息；
- 自动化测试结果和实现说明的必需章节。

面积误差使用归一化份额比较，容差为 `0.02`。颜色归一化容差为 `0.001`。状态比较只比较
业务字段并忽略数组顺序和亚像素几何差异。

## 不由机器证明

- “像不像参考站”、视觉品味、配色美感、排版层次和 Logo 质量；
- Safari/cross-browser、像素级视觉回归、动画质感和主观流畅度；
- 真实生产行情正确性、长期性能和 OS 级隔离。

这些项进入人工视觉 Review 或独立性能/跨浏览器验证，不得由一次 Chromium observation
或截图哈希伪装成已证明。
