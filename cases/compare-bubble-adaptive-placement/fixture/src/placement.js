import {
  COMPARE_BUBBLE_ARROW_OFFSET,
  COMPARE_BUBBLE_BORDER,
  COMPARE_DOT_RADIUS,
} from './constants.js';

export function toNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function resolveCompareBubbleMaxWidth({ anchorX, bounds, padding, gap }) {
  // TODO: 计算左右两侧的最大可用净空宽度
  return 0;
}

/**
 * 求解气泡在图表容器内的自适应放置位置，防止裁切与重叠
 */
export function resolveCompareBubblePosition({
  anchorX,
  anchorY,
  width,
  height,
  bounds,
  placement = 'auto',
  padding,
  gap,
  guideYs,
  avoidOverlap = true,
}) {
  // TODO: 实现几何判定、自动侧向翻转、Clamp 限位以及辅助线避让
  return {
    visible: true,
    left: 0,
    top: 0,
    side: 'left',
    vertical: 'middle',
  };
}
