# 完整需求真相：移动端雷达图半径配置覆盖缺陷排查

## 1. 业务目标
修复移动端图表主题解析器中的 `parseRadarSysRadius` 函数逻辑缺陷，确保业务方传入数字标量、百分比字符串或内外径数组形式的自定义半径时，配置不会被移动端主题默认的 `radarSysRadius` 覆盖。

## 2. 问题根因
原代码实现如下：
```javascript
export function parseRadarSysRadius(radarSystems, ...args) {
  const [, , optionToken] = args;
  radarSystems.forEach(radar => {
    const themeRadarSysRadius = optionToken.dvRadar.radarSysRadius;
    if (!isObject(radar.radius)) {
      radar.radius = themeRadarSysRadius;
    } else {
      radar.radius = overrideIfUndefined(radar.radius, themeRadarSysRadius);
    }
  });
}
```
当 `radar.radius` 为数字（如 `50`）或字符串（如 `'75%'`）时，`!isObject(radar.radius)` 判定为 `true`，导致直接赋值为 `themeRadarSysRadius`，抹除了用户的配置。

## 3. 验收契约与修复要求
1. **纯净修复**：
   - 移除错误的 `!isObject(radar.radius)` 分支判断；
   - 统一采用 `overrideIfUndefined(radar.radius, themeRadarSysRadius)` 进行覆盖合并。
2. **多形态数据兼容性**：
   - 当 `radar.radius === undefined` 时：回退使用主题默认值 `themeRadarSysRadius`；
   - 当 `radar.radius` 为 `number`（如 `50`）：保留用户值 `50`；
   - 当 `radar.radius` 为 `string`（如 `'60%'`）：保留用户值 `'60%'`；
   - 当 `radar.radius` 为 `Array`（如 `['20%', '80%']`）：保留用户值；
   - 当 `radar.radius` 为 `0` 时：作为合法数值处理，不应误判为缺失而覆盖。
3. **保持既有架构**：
   - 不修改其他 series 的解析函数；
   - 保持与 `overrideIfUndefined` 工具函数的调用约定。
