/**
 * 判断是否为纯对象
 */
export function isObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * 仅当目标值为 undefined 时使用覆盖值，否则保留目标值
 */
export function overrideIfUndefined(value, override) {
  return typeof value === 'undefined' ? override : value;
}
