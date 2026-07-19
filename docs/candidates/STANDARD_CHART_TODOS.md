# StandardChart TODO / 存量维护候选

这些候选来自源码中仍存在的 TODO/FIXME。它们适合测试 Agent 是否能理解存量架构、完成修改并补齐回归，而不是从零生成页面。

## 当前状态

`deferred-to-next-phase`

首期不建设 TODO 正式 Case。本文仅保留候选证据和后续选择依据，`CAND-TODO-002` 也不进入本期 Suite。

## 复杂度复核结论

TODO 行数少不代表任务简单，但首期主 Case 必须能覆盖真实维护瓶颈：定位影响面、理解框架机制、保持兼容、构造回归和证明没有性能倒退。只改两处分支条件的任务，最多作为校准题。

## CAND-TODO-001｜dvScatter 子元素点击与重复点击取消

### 来源类型

`observed`

来源：

`src/extension/series/dvScatter/action.ts`

现存 TODO：

- 点击气泡内部子元素时，也应识别为整个气泡；
- 已选中的气泡再次点击时，应取消选中。

### 需求摘要

修复 dvScatter 点击选择行为：

- 点击气泡本体、标签或内部子元素，都应选中同一数据项；
- 再次点击当前选中气泡取消选中；
- 点击空白区域取消选中；
- 不影响移动端 near-search；
- 补充浏览器 smoke 和必要单元测试。

### 建议难度

`medium`

### 推荐度

适合校准存量代码 Runner 和交互测试，但单独作为“是否大幅提效”的证据偏小。

## CAND-TODO-002｜移动折线极值标签性能与样式一致性

### 来源类型

`observed`

来源：

`src/theme/mobile/series/line.ts`

现存问题：

- 极值标签处理存在高复杂度风险；
- 折线颜色和拐点样式的优先级、一致性仍有 TODO。

### 需求摘要

在不改变现有视觉结果的情况下：

- 降低多系列、长序列下极值标签处理开销；
- 保持用户配置优先于主题；
- 线、拐点和强调态颜色一致；
- 为大数据量增加性能基线和回归样例。
- 验证多系列、用户自定义颜色、主题颜色、默认颜色、symbol 与 emphasis 的优先级矩阵；
- 确认优化没有改变既有 option 合并语义和移动端视觉；
- 给出优化前后的复杂度说明和同机性能证据。

### 建议难度

`medium-hard`

### 推荐度

高。它同时要求存量架构理解、性能诊断、配置优先级和视觉回归，更接近真实维护瓶颈。

## CAND-TODO-003｜WordCloud cover/fill 模式

### 来源类型

`observed`

来源：

`src/extension/series/dvWordCloud/WordCloudSeries.ts`

现存 TODO：

`fillMode` 已声明 `contain | cover | fill`，但 `cover` 和 `fill` 尚未完整实现。

### 需求摘要

补全词云遮罩填充：

- `contain` 保持现状；
- `cover` 可以重复或扩展布局覆盖容器；
- `fill` 等比拉伸一次布局填满容器；
- 兼容图片、DataURI 和 series layout mask；
- 处理空遮罩、极端宽高比和 resize；
- 添加视觉回归。
- 保持已有 `contain` 行为和 API 兼容；
- 解释 cover/fill 在极端宽高比、resize、多次更新下的几何语义；
- 对图片、DataURI、其他 series 生成的 mask 分别给出回归样例；
- 证明重复布局不会产生不可控内存增长或随机漂移。

### 建议难度

`hard`

## CAND-TODO-004｜WordCloud 旋转范围

### 来源类型

`observed`

来源：

`src/extension/series/dvWordCloud/WordCloudSeries.ts`

现存 TODO：

`rotateRange` 和 `rotateSplitCount` 已有配置声明，旋转行为尚未完整实现。

### 需求摘要

实现可配置的词条角度：

- 在指定角度范围内按分段取值；
- 固定随机种子时结果稳定；
- 不破坏碰撞与边界处理；
- 单一角度、负角度、跨零区间正确；
- 补充类型、示例和视觉回归。

### 建议难度

`medium-hard`

## 推荐顺序

如果目标是验证真实提效而不是先跑通平台：

1. `CAND-TODO-002`：推荐首期，性能、主题语义和回归兼具；
2. `CAND-TODO-003`：区分度最高，但 fixture 和视觉验收建设成本也最高；
3. `CAND-TODO-004`：适合测试算法与确定性；
4. `CAND-TODO-001`：适合校准，不作为核心提效证据。
